import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Actor } from '../../core/access';
import { AssessmentService } from '../assessment/assessment.service';
import { AiService } from './ai.service';
import { LearnerFact, RemarkDraft, buildRemarksPrompt, factsFor, remarksDigest, remarksTemplateVersion, templateRemark, validateRemarks } from './report-remarks-draft';
import { IndicatorFact, WorksheetDraft, buildWorksheetPrompt, numbered, templateWorksheet, validateWorksheet, worksheetDigest, worksheetTemplateVersion } from './worksheet-draft';

const CHUNK = 10;
type Usage = { provider: string; model: string | null; inputTokens: number | null; outputTokens: number | null };
const add = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);

// Report remarks and practice worksheets. Same three phases as the Nursery/KG draft: prepare (authorize, build facts, gate) inside a
// transaction, call the model with no transaction held, then log the run. Drafts are returned to the person and never saved by this service.
@Injectable()
export class AiDraftsService {
  constructor(private readonly ai: AiService, private readonly assessment: AssessmentService) {}

  async prepareRemarks(client: PoolClient, actor: Actor, body: { classId: string; termId: string; learnerIds?: string[] }) {
    const results = await this.assessment.results(client,actor,body.classId,body.termId); // authorizes the class (assigned teacher or head)
    const remarks = (await this.assessment.remarks(client,actor,body.classId,body.termId)).items;
    // By default only learners still without a class teacher's remark; published reports are never redrafted.
    const wanted = new Set(body.learnerIds?.length ? body.learnerIds : remarks.filter(r => !r.teacherRemark).map(r => r.learnerId));
    const open = new Set(remarks.filter(r => !r.locked && wanted.has(r.learnerId)).map(r => r.learnerId));
    const term = results.term as { start_date: string; end_date: string };
    const attendance = new Map((await client.query(`SELECT m.learner_id,count(*) FILTER (WHERE m.mark IN ('present','late'))::int AS present,count(*) FILTER (WHERE m.mark<>'unmarked')::int AS marked
      FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id
      WHERE r.school_id=$1 AND r.class_id=$2 AND r.day>=$3 AND r.day<=$4 AND r.status IN ('submitted','locked') GROUP BY m.learner_id`,[actor.schoolId,body.classId,term.start_date,term.end_date])).rows.map(row => [row.learner_id as string,{present:row.present as number,possible:row.marked as number}]));
    const facts = factsFor(results.items.filter(row => open.has(row.learnerId)),attendance,new Map(remarks.map(r => [r.learnerId,{conduct:r.conduct,interest:r.interest}])));
    if (!facts.length) throw new ConflictException(open.size ? 'Remarks are drafted from this term\'s results. Enter both the class score and the exam score for at least one subject first' : 'Every learner already has a remark, or the reports are published');
    const subjectNames = (await client.query('SELECT name FROM subjects WHERE school_id=$1',[actor.schoolId])).rows.map(row => row.name as string);
    const note = await this.ai.gate(client,actor.schoolId);
    return {facts,level:(results.class as { level: string }).level,subjectNames,note};
  }

  async completeRemarks(prepared: Awaited<ReturnType<AiDraftsService['prepareRemarks']>>) {
    const started = Date.now(), provider = prepared.note ? null : this.ai.providerFor();
    const drafts = new Map<string, RemarkDraft>(); const usage: Usage = { provider: provider?.name ?? 'template', model: provider?.model ?? null, inputTokens: null, outputTokens: null };
    let note = prepared.note ?? (provider ? null : 'no_provider');
    if (provider) {
      const chunks: LearnerFact[][] = [];
      for (let i = 0; i < prepared.facts.length; i += CHUNK) chunks.push(prepared.facts.slice(i,i + CHUNK));
      const outcomes = await Promise.all(chunks.map(async chunk => {
        try {
          const result = await provider.complete({...buildRemarksPrompt(chunk,prepared.level),timeoutMs:30_000});
          usage.inputTokens = add(usage.inputTokens,result.inputTokens); usage.outputTokens = add(usage.outputTokens,result.outputTokens);
          const checked = validateRemarks(result.text,chunk,prepared.subjectNames);
          if (!checked.ok) return `rejected:${checked.reason}`;
          checked.drafts.forEach((draft,id) => drafts.set(id,draft)); return null;
        } catch { return 'provider_error'; }
      }));
      note = outcomes.find(Boolean) ?? null;
    }
    const items = prepared.facts.map(fact => drafts.get(fact.learnerId) ?? templateRemark(fact));
    const fromAi = items.filter(item => item.source === 'ai').length;
    if (provider && fromAi < items.length && !note) note = `partial:${items.length - fromAi}`;
    return {items,usage,source:(fromAi ? 'ai' : 'template') as 'ai' | 'template',status:(fromAi === items.length ? 'ok' : 'fallback') as 'ok' | 'fallback',note,latencyMs:Date.now() - started};
  }

  async recordRemarks(client: PoolClient, actor: Actor, body: { classId: string; termId: string }, prepared: Awaited<ReturnType<AiDraftsService['prepareRemarks']>>, done: Awaited<ReturnType<AiDraftsService['completeRemarks']>>) {
    const runId = await this.ai.logRun(client,actor,{feature:'assessment.report-remarks',templateVersion:remarksTemplateVersion,...done.usage,source:done.source,status:done.status,
      sourceRefs:{classId:body.classId,termId:body.termId,learnerIds:prepared.facts.map(f => f.learnerId)},digest:remarksDigest(done.items),latencyMs:done.latencyMs,note:done.note});
    return {runId,source:done.source,status:done.status,note:done.note,fromAi:done.items.filter(i => i.source === 'ai').length,items:done.items};
  }

  async prepareWorksheet(client: PoolClient, actor: Actor, indicatorId: string) {
    const row = (await client.query(`SELECT i.code,i.strand,i.sub_strand,i.description,i.grade,s.name AS subject FROM curriculum_indicators i JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE i.school_id=$1 AND i.id=$2 AND i.retired_at IS NULL`,[actor.schoolId,indicatorId])).rows[0];
    if (!row) throw new NotFoundException('Indicator unavailable or retired');
    const fact: IndicatorFact = {subject:row.subject,level:'Basic school',grade:row.grade,code:row.code,strand:row.strand,subStrand:row.sub_strand,description:row.description};
    return {fact,note:await this.ai.gate(client,actor.schoolId)};
  }

  async completeWorksheet(prepared: Awaited<ReturnType<AiDraftsService['prepareWorksheet']>>) {
    const started = Date.now(), provider = prepared.note ? null : this.ai.providerFor();
    const local = (note: string): { draft: WorksheetDraft; usage: Usage; source: 'template'; status: 'fallback'; note: string; latencyMs: number } =>
      ({draft:templateWorksheet(prepared.fact),usage:{provider:'template',model:null,inputTokens:null,outputTokens:null},source:'template',status:'fallback',note,latencyMs:Date.now() - started});
    if (!provider) return local(prepared.note ?? 'no_provider');
    try {
      const result = await provider.complete(buildWorksheetPrompt(prepared.fact));
      const checked = validateWorksheet(result.text);
      if (!checked.ok) return local(`rejected:${checked.reason}`);
      return {draft:checked.draft,usage:{provider:provider.name,model:provider.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens},source:'ai' as const,status:'ok' as const,note:null,latencyMs:Date.now() - started};
    } catch { return local('provider_error'); }
  }

  async recordWorksheet(client: PoolClient, actor: Actor, indicatorId: string, done: Awaited<ReturnType<AiDraftsService['completeWorksheet']>>) {
    const runId = await this.ai.logRun(client,actor,{feature:'practice.worksheet',templateVersion:worksheetTemplateVersion,...done.usage,source:done.source,status:done.status,
      sourceRefs:{indicatorId},digest:worksheetDigest(done.draft),latencyMs:done.latencyMs,note:done.note});
    return {runId,source:done.source,status:done.status,note:done.note,...done.draft,detail:numbered(done.draft.questions)};
  }
}
