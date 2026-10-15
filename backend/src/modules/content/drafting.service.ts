import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AiProvider, THINKING_ROOM, configuredProvider } from '../ai/ai.provider';
import { ContentService } from './content.service';
import { DEFAULT_BATCH, IndicatorFact, batchDigest, buildBatchPrompt, draftingTemplateVersion, validateBatch } from './drafting';
import { Neighbour, QuestionBody, stageOf } from './checks';

export type Unavailable = 'ai_disabled_platform' | 'no_provider' | 'no_budget' | 'budget_exhausted';
const WHY: Record<Unavailable, string> = {
  ai_disabled_platform: 'AI drafting is switched off for the platform',
  no_provider: 'No AI provider is set up',
  no_budget: 'Drafting has no budget this month. The platform administrator sets one',
  budget_exhausted: 'This month\'s drafting budget cannot cover another batch',
};
const unavailable = (reason: Unavailable) => new ConflictException({ message: WHY[reason], code: 'DRAFTING_UNAVAILABLE', details: { reason } });

export interface Prepared { runId: string; level: number; count: number; stage: ReturnType<typeof stageOf>; existing: Neighbour[]; prompt: ReturnType<typeof buildBatchPrompt> }
export interface Completed { bodies: QuestionBody[]; dropped: number; reasons: Record<string, number>; inputTokens: number | null; outputTokens: number | null; latencyMs: number; note: string | null }

const RUN_COLUMNS = `id,requested_by AS "requestedBy",requested_by_name AS "requestedByName",subject,class_level AS "classLevel",code,description AS indicator,level,requested,drafted,dropped,drafts_waiting AS "draftsWaiting",status,provider,model,
  input_tokens AS "inputTokens",output_tokens AS "outputTokens",reserved_tokens AS "reservedTokens",latency_ms AS "latencyMs",note,created_at AS "createdAt",finished_at AS "finishedAt"`;

// Claude drafts questions in batches for the shared library. Three phases, as for the school drafts: begin the run (authorize, check the
// platform's budget and reserve against it) in a short transaction, call the model with no transaction held, then finish the run, which
// is where the drafts are created. Drafts are the requester's, start as drafts and still need a named human reviewer.
@Injectable()
export class ContentDraftingService {
  // Tests inject a scripted provider; production uses the configured one.
  providerOverride: AiProvider | null = null;
  constructor(private readonly content: ContentService) {}
  private provider() { return this.providerOverride ?? configuredProvider(); }
  private gate(): Unavailable | null { return process.env.AI_ENABLED !== 'true' ? 'ai_disabled_platform' : this.provider() ? null : 'no_provider'; }

  async budget(client: PoolClient) {
    const row = (await client.query('SELECT monthly_token_cap,used_tokens,version FROM content_ai_budget_status()')).rows[0];
    const cap = row.monthly_token_cap as number, used = Number(row.used_tokens);
    return { monthlyTokenCap: cap, usedTokens: used, remainingTokens: Math.max(cap - used, 0), version: row.version as number };
  }
  async runs(client: PoolClient, limit: number) { return (await client.query(`SELECT ${RUN_COLUMNS} FROM content_ai_runs_list($1)`, [limit])).rows; }
  async overview(client: PoolClient) {
    const { version: _version, ...budget } = await this.budget(client);
    return { enabled: process.env.AI_ENABLED === 'true', providerConfigured: this.provider() !== null, ...budget, runs: await this.runs(client, 20) };
  }

  async prepare(client: PoolClient, userId: string, dto: { indicatorId: string; level: number; count?: number }): Promise<Prepared> {
    await this.content.need(client, 'author', 'Only a content author drafts with Claude');
    const reason = this.gate();
    if (reason) throw unavailable(reason);
    const entry = (await client.query(
      `SELECT subject,level,code,strand,sub_strand AS "subStrand",description,term_guidance AS "termGuidance",retired_at IS NOT NULL AS retired FROM catalogue_indicators WHERE id=$1`, [dto.indicatorId])).rows[0];
    if (!entry) throw new NotFoundException('Catalogue entry unavailable');
    if (entry.retired) throw new ConflictException('That catalogue entry is retired');
    const count = dto.count ?? DEFAULT_BATCH;
    // Wording still in play for this indicator, newest first: the model is told not to repeat it, and a draft that does is dropped.
    const existing = (await client.query(
      `SELECT i.id AS "itemId",v.body->>'prompt' AS text FROM content_items i JOIN content_versions v ON v.item_id=i.id AND v.status IN ('draft','in_review','published')
       WHERE i.indicator_id=$1 AND i.kind='question' ORDER BY v.created_at DESC,v.id LIMIT 500`, [dto.indicatorId])).rows as Neighbour[];
    const fact: IndicatorFact = { subject: entry.subject, classLevel: entry.level, code: entry.code, strand: entry.strand, subStrand: entry.subStrand, description: entry.description, termGuidance: entry.termGuidance };
    const prompt = buildBatchPrompt(fact, dto.level, count, existing.map(n => n.text));
    // Held against the month's budget until the run reports what it spent: the reply, the model's thinking room and the prompt.
    const reserve = prompt.maxTokens + THINKING_ROOM + Math.ceil((prompt.system.length + prompt.user.length) / 3);
    const provider = this.provider()!;
    try {
      const runId = (await client.query('SELECT content_ai_begin_run($1,$2,$3,$4,$5,$6,$7) AS id', [dto.indicatorId, dto.level, count, draftingTemplateVersion, provider.name, provider.model, reserve])).rows[0].id as string;
      return { runId, level: dto.level, count, stage: stageOf(entry.level), existing, prompt };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'XB001') throw unavailable('no_budget');
      if (code === 'XB002') throw unavailable('budget_exhausted');
      throw error;
    }
  }

  // No database transaction is held while waiting for the provider. A failure here is a failed run, never an exception.
  async complete(prepared: Prepared): Promise<Completed> {
    const started = Date.now(), provider = this.provider();
    const failed = (note: string, extra: Partial<Completed> = {}): Completed => ({ bodies: [], dropped: 0, reasons: {}, inputTokens: null, outputTokens: null, latencyMs: Date.now() - started, note, ...extra });
    if (!provider) return failed('provider_error');
    try {
      const result = await provider.complete(prepared.prompt);
      const usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      const checked = validateBatch(result.text, { level: prepared.level, stage: prepared.stage, count: prepared.count, existing: prepared.existing });
      if (!checked.ok) return failed(`rejected:${checked.reason}`, usage);
      if (!checked.bodies.length) return failed('nothing_usable', { ...usage, dropped: checked.dropped, reasons: checked.reasons });
      // A Claude draft is only kept against tokens the provider reported, so the budget knows what it cost.
      if (usage.inputTokens === null || usage.outputTokens === null) return failed('no_usage', { dropped: checked.dropped, reasons: checked.reasons });
      return { bodies: checked.bodies, dropped: checked.dropped, reasons: checked.reasons, ...usage, latencyMs: Date.now() - started, note: null };
    } catch { return failed('provider_error'); }
  }

  // Creates the drafts and closes the run in one step; with nothing to keep it closes the run as failed.
  async finish(client: PoolClient, prepared: Prepared, done: Completed) {
    const keep = done.bodies.length > 0;
    const ids = (await client.query('SELECT content_ai_finish_run($1,$2,$3,$4,$5,$6,$7,$8) AS ids',
      [prepared.runId, keep ? JSON.stringify(done.bodies) : null, done.dropped, done.inputTokens, done.outputTokens, done.latencyMs, keep ? batchDigest(done.bodies) : null, done.note])).rows[0].ids as string[];
    return { runId: prepared.runId, status: ids.length ? 'ok' : 'failed', requested: prepared.count, drafted: ids.length, dropped: done.dropped, reasons: done.reasons, versionIds: ids, note: done.note };
  }
  // The drafts could not be saved (for example the catalogue entry was retired meanwhile): close the run so its reservation is settled.
  abandon(done: Completed): Completed { return { ...done, bodies: [], note: 'save_failed' }; }

  // The requester sends every draft of a run to review. A draft the checks now refuse (say, someone published the same wording
  // meanwhile) stays a draft, with the reason, for them to fix or withdraw.
  async submitRun(client: PoolClient, userId: string, runId: string) {
    await this.content.need(client, 'author', 'Only a content author sends drafts to review');
    const versions = (await client.query('SELECT id,status,author_id FROM content_versions WHERE ai_run_id=$1 ORDER BY created_at,id', [runId])).rows as { id: string; status: string; author_id: string }[];
    if (!versions.length) throw new NotFoundException('That run has no drafts');
    if (versions.some(v => v.author_id !== userId)) throw new ForbiddenException('Only the person who asked for the batch sends it to review');
    let submitted = 0;
    const blocked: { versionId: string; findings: { code: string; message: string }[] }[] = [];
    for (const draft of versions.filter(v => v.status === 'draft')) {
      await client.query('SAVEPOINT send_draft');
      try {
        await this.content.submit(client, userId, draft.id);
        await client.query('RELEASE SAVEPOINT send_draft');
        submitted++;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT send_draft');
        if (!(error instanceof UnprocessableEntityException)) throw error;
        const findings = ((error.getResponse() as { details?: { findings?: { code: string; message: string; blocking: boolean }[] } }).details?.findings ?? []).filter(f => f.blocking);
        blocked.push({ versionId: draft.id, findings: findings.map(({ code, message }) => ({ code, message })) });
      }
    }
    return { submitted, blocked };
  }
}
