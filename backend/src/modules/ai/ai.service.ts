import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { EarlyYearsReportsService } from '../early-years/reports.service';
import { AiProvider, configuredProvider } from './ai.provider';
import { Draft, ObservationFact, buildPrompt, digestOf, draftTemplateVersion, factsFrom, templateDraft, validateDraft } from './early-years-draft';

export interface DraftRequest { learnerId: string; enrolmentId: string; periodStart: string; periodEnd: string }
export interface Prepared { facts: ObservationFact[]; level: string; classId: string; useAi: boolean; note: string | null }
export interface Completed { draft: Draft; source: 'ai' | 'template'; status: 'ok' | 'fallback'; provider: string; model: string | null; inputTokens: number | null; outputTokens: number | null; latencyMs: number; note: string | null }

@Injectable()
export class AiService {
  // Tests inject a scripted provider; production uses the configured one.
  providerOverride: AiProvider | null = null;
  constructor(private readonly reports: EarlyYearsReportsService) {}
  private provider() { return this.providerOverride ?? configuredProvider(); }

  async settings(client: PoolClient, schoolId: string) {
    const row = (await client.query('SELECT enabled,monthly_run_cap,acknowledgement,version FROM ai_settings WHERE school_id=$1',[schoolId])).rows[0];
    const runs = Number((await client.query("SELECT count(*) FROM ai_runs WHERE school_id=$1 AND source='ai' AND created_at>=date_trunc('month',now() AT TIME ZONE 'Africa/Accra') AT TIME ZONE 'Africa/Accra'",[schoolId])).rows[0].count);
    return {enabled:row?.enabled ?? false,monthlyRunCap:row?.monthly_run_cap ?? 200,acknowledgement:row?.acknowledgement ?? null,version:row?.version ?? 0,
      platformEnabled:process.env.AI_ENABLED === 'true',providerConfigured:this.provider() !== null,runsThisMonth:runs};
  }
  saveSettings(client: PoolClient, actor: Actor, body: {operationId:string;enabled:boolean;monthlyRunCap:number;acknowledgement?:string;version?:number}) {
    return command(client,actor,body.operationId,'ai.settings',body,async () => {
      const current = (await client.query('SELECT version FROM ai_settings WHERE school_id=$1',[actor.schoolId])).rows[0];
      if (current && body.version !== current.version) throw new ConflictException('AI settings changed. Reload before saving');
      if (body.enabled && !body.acknowledgement?.trim()) throw new BadRequestException('Confirm the data-protection acknowledgement before enabling AI');
      const values = [actor.schoolId,body.enabled,body.monthlyRunCap,body.acknowledgement?.trim() ?? null,actor.membershipId];
      if (current) await client.query('UPDATE ai_settings SET enabled=$2,monthly_run_cap=$3,acknowledgement=$4,updated_by=$5,updated_at=now(),version=version+1 WHERE school_id=$1',values);
      else await client.query('INSERT INTO ai_settings(school_id,enabled,monthly_run_cap,acknowledgement,updated_by) VALUES($1,$2,$3,$4,$5)',values);
      await audit(client,actor,body.enabled ? 'ai.enabled' : 'ai.disabled',actor.schoolId,{monthlyRunCap:body.monthlyRunCap});
      return this.settings(client,actor.schoolId);
    });
  }

  // Phase 1 (inside a short transaction): authorize, build minimised facts, decide whether the model may be used.
  async prepare(client: PoolClient, actor: Actor, body: DraftRequest): Promise<Prepared> {
    const inputs = await this.reports.draftInputs(client,actor,body);
    const facts = factsFrom(inputs.observations);
    if (!facts.some(fact => fact.status === 'observed')) throw new ConflictException('There are no observed entries in this period to draft from');
    const note = await this.gate(client,actor.schoolId);
    return {facts,level:inputs.level,classId:inputs.classId,useAi:note === null,note};
  }
  // Why the model may not be used right now (null = it may): platform kill switch, school switch, provider key, monthly cap.
  async gate(client: PoolClient, schoolId: string): Promise<string | null> {
    const settings = await this.settings(client,schoolId);
    if (!settings.platformEnabled) return 'ai_disabled_platform';
    if (!settings.enabled) return 'ai_disabled_school';
    if (!settings.providerConfigured) return 'no_provider';
    if (settings.runsThisMonth >= settings.monthlyRunCap) return 'monthly_cap_reached';
    return null;
  }
  // The provider for a run that passed the gate (scripted in tests).
  providerFor() { return this.provider(); }
  // Append-only run log: IDs, digest, tokens and outcome; never the prompt or the generated text.
  async logRun(client: PoolClient, actor: Actor, run: {feature:string;templateVersion:string;provider:string;model:string | null;source:'ai' | 'template';status:'ok' | 'fallback';sourceRefs:object;digest:string;inputTokens:number | null;outputTokens:number | null;latencyMs:number;note:string | null}) {
    const id = randomUUID();
    await client.query('INSERT INTO ai_runs(id,school_id,actor_membership_id,feature,template_version,provider,model,source,status,source_refs,output_digest,input_tokens,output_tokens,latency_ms,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
      [id,actor.schoolId,actor.membershipId,run.feature,run.templateVersion,run.provider,run.model,run.source,run.status,JSON.stringify(run.sourceRefs),run.digest,run.inputTokens,run.outputTokens,run.latencyMs,run.note]);
    return id;
  }

  // Phase 2 (no database transaction is held while waiting for the provider).
  async complete(prepared: Prepared): Promise<Completed> {
    const started = Date.now(), provider = this.provider();
    const local = (note: string | null, status: 'ok' | 'fallback'): Completed => ({draft:templateDraft(prepared.facts),source:'template',status,provider:'template',model:null,inputTokens:null,outputTokens:null,latencyMs:Date.now() - started,note});
    if (!prepared.useAi || !provider) return local(prepared.note ?? 'no_provider','fallback');
    try {
      const result = await provider.complete(buildPrompt(prepared.facts,prepared.level));
      const checked = validateDraft(result.text,prepared.facts);
      if (!checked.ok) return local(`rejected:${checked.reason}`,'fallback');
      return {draft:checked.draft,source:'ai',status:'ok',provider:provider.name,model:provider.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens,latencyMs:Date.now() - started,note:null};
    } catch { return local('provider_error','fallback'); }
  }

  // Phase 3: log the run (no prompt, no generated text) and return the draft to the person.
  async record(client: PoolClient, actor: Actor, body: DraftRequest, prepared: Prepared, done: Completed) {
    const id = randomUUID();
    await client.query('INSERT INTO ai_runs(id,school_id,actor_membership_id,feature,template_version,provider,model,source,status,source_refs,output_digest,input_tokens,output_tokens,latency_ms,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
      [id,actor.schoolId,actor.membershipId,'early-years.report-draft',draftTemplateVersion,done.provider,done.model,done.source,done.status,JSON.stringify({learnerId:body.learnerId,enrolmentId:body.enrolmentId,periodStart:body.periodStart,periodEnd:body.periodEnd,observationIds:[...new Set(prepared.facts.map(fact => fact.observationId))]}),digestOf(done.draft),done.inputTokens,done.outputTokens,done.latencyMs,done.note]);
    return {runId:id,source:done.source,status:done.status,note:done.note,strengths:done.draft.strengths,nextSteps:done.draft.nextSteps,citations:done.draft.citations};
  }
  async feedback(client: PoolClient, actor: Actor, runId: string, outcome: string) {
    const run = (await client.query('SELECT actor_membership_id FROM ai_runs WHERE school_id=$1 AND id=$2',[actor.schoolId,runId])).rows[0];
    if (!run || run.actor_membership_id !== actor.membershipId) throw new NotFoundException('Draft unavailable');
    await client.query('INSERT INTO ai_run_feedback(id,school_id,run_id,actor_membership_id,outcome) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,run_id,actor_membership_id) DO NOTHING',[randomUUID(),actor.schoolId,runId,actor.membershipId,outcome]);
    return {recorded:true};
  }
}
