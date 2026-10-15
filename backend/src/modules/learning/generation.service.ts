import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit } from '../../core/commands';
import { AiService } from '../ai/ai.service';
import { Neighbour, QuestionBody, runChecks, stageOf } from '../content/checks';
import { IndicatorFact, MAX_BATCH, buildBatchPrompt, draftingTemplateVersion, validateBatch } from '../content/drafting';
import { LessonBody, buildLessonPrompt, lessonTemplateVersion, validateLesson } from './lesson';
import { accraToday, allows, scopeOf } from './scope';
import { TARGET_PER_LEVEL } from './topics.service';

const LEVELS = [1, 2, 3];
const MAX_POSITION = 100;
// A request is one run against the school's monthly cap, however many model calls it makes (the lesson and one per level: at most four).
// Only one request per topic is in flight at a time in this process; the lock in `record` keeps other processes from over-filling a level.
const IN_FLIGHT_MS = 5 * 60_000;
type LevelWork = { level: number; need: number };
type LevelResult = { level: number; bodies: QuestionBody[]; dropped: number; failure: string | null };
type LessonResult = { state: 'made'; lesson: LessonBody } | { state: 'kept' } | { state: 'failed'; failure: string };
const promptSafe = (text: string) => text.replace(/[^A-Za-z0-9 .\-]/g,' ').replace(/\s+/g,' ').trim().slice(0,40) || 'Primary';
const add = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);

// Claude writes a lesson and levelled practice questions from one approved topic, from the topic's wording alone: no learner, no school, no
// name. Three phases, like every AI draft here: prepare (authorise, count what exists, check the AI gate) in a transaction, call the model
// with no transaction held, then check and store inside a transaction that serialises with other requests for the same topic. Asking again
// makes only what is missing, so a failed or partial request is simply repeated.
@Injectable()
export class GenerationService {
  constructor(private readonly ai: AiService) {}
  private static readonly running = new Map<string, number>();
  // True when this request may call the model for the approval; false when another request for it is already waiting on the model.
  claim(schoolId: string, approvalId: string) {
    const key = `${schoolId}:${approvalId}`, since = GenerationService.running.get(key);
    if (since !== undefined && Date.now() - since < IN_FLIGHT_MS) return false;
    GenerationService.running.set(key,Date.now()); return true;
  }
  release(schoolId: string, approvalId: string) { GenerationService.running.delete(`${schoolId}:${approvalId}`); }
  // What the person is told when the same topic is already being made.
  busy(prepared: Awaited<ReturnType<GenerationService['prepare']>>, approvalId: string) {
    return { approvalId, generated: false, note: 'already_running', lesson: prepared.hasLesson ? 'kept' : 'skipped', levels: LEVELS.map(level => ({ level, added: 0, dropped: 0, total: prepared.counts[level - 1] })) };
  }

  async prepare(client: PoolClient, actor: Actor, approvalId: string) {
    const a = (await client.query(`SELECT a.indicator_id,a.grade,a.retired_at,t.end_date::text AS term_end,i.code,i.strand,i.sub_strand,i.description,i.retired_at AS indicator_retired,s.name AS subject
      FROM topic_approvals a JOIN terms t ON t.school_id=a.school_id AND t.id=a.term_id JOIN curriculum_indicators i ON i.school_id=a.school_id AND i.id=a.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE a.school_id=$1 AND a.id=$2`,[actor.schoolId,approvalId])).rows[0];
    if (!a || !allows(await scopeOf(client,actor),a.grade)) throw new NotFoundException('Topic unavailable');
    if (a.retired_at) throw new ConflictException('This topic is retired. Approve it again to make more');
    if (a.indicator_retired) throw new ConflictException('This topic has been retired from the curriculum');
    if (a.term_end < await accraToday(client)) throw new ConflictException('That term has ended, so nothing more is made for it. Approve the topic for the new term');
    // The class level is the school's own wording; only plain letters, numbers and punctuation go into a prompt.
    const fact: IndicatorFact = { subject: a.subject, classLevel: promptSafe(a.grade), code: a.code, strand: a.strand, subStrand: a.sub_strand, description: a.description, termGuidance: null };
    const state = await this.state(client,actor.schoolId,a.indicator_id,a.grade);
    // A level has 100 places for questions over its life. A level with no place left is reported, not asked for.
    const deficit = LEVELS.map(level => Math.max(0,TARGET_PER_LEVEL - state.counts[level - 1]!));
    const work: LevelWork[] = LEVELS.map(level => ({ level, need: Math.min(deficit[level - 1]!,Math.max(0,MAX_POSITION - state.maxPosition[level - 1]!)) }));
    const full = work.some((w,n) => deficit[n]! > 0 && w.need === 0);
    const idle = state.lesson && work.every(w => w.need === 0);
    return { indicatorId: a.indicator_id as string, grade: a.grade as string, fact, existing: state.existing, counts: state.counts, hasLesson: state.lesson, work, idle,
      note: idle ? (full ? 'level_full' : null) : await this.ai.gate(client,actor.schoolId) };
  }

  // What exists for this topic and class level: live generated questions per level, the highest place used in each level, a current lesson, and every wording a new question must not repeat.
  private async state(client: PoolClient, schoolId: string, indicatorId: string, grade: string) {
    const live = (await client.query(`SELECT q.level,q.prompt FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id
      WHERE s.school_id=$1 AND s.indicator_id=$2 AND s.source='generated' AND lower(s.grade)=lower($3) AND q.retired_at IS NULL ORDER BY q.level,q.position`,[schoolId,indicatorId,grade])).rows;
    const highest = (await client.query(`SELECT q.level,max(q.position)::int AS p FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id
      WHERE s.school_id=$1 AND s.indicator_id=$2 AND s.source='generated' AND lower(s.grade)=lower($3) GROUP BY q.level`,[schoolId,indicatorId,grade])).rows;
    const written = (await client.query(`SELECT q.prompt FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id
      WHERE s.school_id=$1 AND s.indicator_id=$2 AND s.source<>'generated' AND s.retired_at IS NULL AND q.retired_at IS NULL ORDER BY q.level,q.position`,[schoolId,indicatorId])).rows;
    const lesson = (await client.query('SELECT 1 FROM topic_lessons WHERE school_id=$1 AND indicator_id=$2 AND lower(grade)=lower($3) AND retired_at IS NULL',[schoolId,indicatorId,grade])).rowCount! > 0;
    return { counts: LEVELS.map(level => live.filter(q => q.level === level).length), maxPosition: LEVELS.map(level => highest.find(h => h.level === level)?.p ?? 0), lesson,
      existing: [...live.map(q => q.prompt as string),...written.map(q => q.prompt as string)] };
  }

  async complete(prepared: Awaited<ReturnType<GenerationService['prepare']>>) {
    if (prepared.idle || prepared.note) return { skipped: true as const, usage: null, latencyMs: 0 };
    const started = Date.now(), provider = this.ai.providerFor();
    if (!provider) return { skipped: true as const, usage: null, latencyMs: 0 };
    const usage = { inputTokens: null as number | null, outputTokens: null as number | null };
    const spend = (r: { inputTokens: number | null; outputTokens: number | null }) => { usage.inputTokens = add(usage.inputTokens,r.inputTokens); usage.outputTokens = add(usage.outputTokens,r.outputTokens); };
    const stage = stageOf(prepared.fact.classLevel), neighbours: Neighbour[] = prepared.existing.map((text,n) => ({ itemId: `existing-${n}`, text }));
    const lesson = async (): Promise<LessonResult> => {
      if (prepared.hasLesson) return { state: 'kept' };
      try {
        const r = await provider.complete(buildLessonPrompt(prepared.fact)); spend(r);
        const checked = validateLesson(r.text,prepared.fact.description,prepared.fact.classLevel);
        return checked.ok ? { state: 'made', lesson: checked.lesson } : { state: 'failed', failure: `rejected:${checked.reason}` };
      } catch { return { state: 'failed', failure: 'provider_error' }; }
    };
    const level = async ({ level, need }: LevelWork): Promise<LevelResult> => {
      if (!need) return { level, bodies: [], dropped: 0, failure: null };
      try {
        const r = await provider.complete(buildBatchPrompt(prepared.fact,level,Math.min(need,MAX_BATCH),prepared.existing)); spend(r);
        const checked = validateBatch(r.text,{ level, stage, count: need, existing: neighbours });
        return checked.ok ? { level, bodies: checked.bodies, dropped: checked.dropped, failure: null } : { level, bodies: [], dropped: 0, failure: `rejected:${checked.reason}` };
      } catch { return { level, bodies: [], dropped: 0, failure: 'provider_error' }; }
    };
    const [lessonResult, ...levels] = await Promise.all([lesson(),...prepared.work.map(level)]);
    return { skipped: false as const, lesson: lessonResult as LessonResult, levels, usage: { ...usage, provider: provider.name, model: provider.model }, latencyMs: Date.now() - started };
  }

  async record(client: PoolClient, actor: Actor, approvalId: string, prepared: Awaited<ReturnType<GenerationService['prepare']>>, done: Awaited<ReturnType<GenerationService['complete']>>) {
    const { indicatorId, grade } = prepared;
    const summary = (counts: number[], extra: { generated: boolean; note: string | null; lesson: string; added?: number[]; dropped?: number[] }) => ({ approvalId, generated: extra.generated, note: extra.note, lesson: extra.lesson,
      levels: LEVELS.map(level => ({ level, added: extra.added?.[level - 1] ?? 0, dropped: extra.dropped?.[level - 1] ?? 0, total: counts[level - 1] })) });
    if (prepared.idle) return summary(prepared.counts,{ generated: false, note: prepared.note, lesson: 'kept' });
    if (done.skipped) return summary(prepared.counts,{ generated: false, note: prepared.note ?? 'no_provider', lesson: prepared.hasLesson ? 'kept' : 'skipped' });

    // Everything is checked again now: the model took a while, and the topic, the curriculum or the person's class may have changed meanwhile. The rows are
    // locked so a retirement waits for this request to finish storing, or is seen by it.
    const standing = (await client.query(`SELECT a.retired_at,i.retired_at AS indicator_retired FROM topic_approvals a JOIN curriculum_indicators i ON i.school_id=a.school_id AND i.id=a.indicator_id
      WHERE a.school_id=$1 AND a.id=$2 FOR SHARE OF a,i`,[actor.schoolId,approvalId])).rows[0];
    const open = !!standing && !standing.retired_at && !standing.indicator_retired && allows(await scopeOf(client,actor),grade);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`generate:${actor.schoolId}:${indicatorId}:${grade.toLowerCase()}`]);
    const state = await this.state(client,actor.schoolId,indicatorId,grade), stage = stageOf(prepared.fact.classLevel);

    // Decide, in memory, what will be stored: each question is checked again against what exists now (another request may have just added some).
    const seen: Neighbour[] = state.existing.map((text,n) => ({ itemId: `existing-${n}`, text }));
    const plan = LEVELS.map(level => {
      const result = done.levels.find(l => l.level === level)!, take: QuestionBody[] = []; let dropped = result.dropped;
      // Room is what is still missing from 20, and what is left of the level's 100 places.
      const room = Math.max(0,Math.min(TARGET_PER_LEVEL - state.counts[level - 1]!,MAX_POSITION - state.maxPosition[level - 1]!));
      for (const body of open ? result.bodies : []) {
        if (take.length >= room) break;
        if (runChecks('question',stage,body,seen).findings.some(f => f.blocking)) { dropped++; continue; }
        take.push(body); seen.push({ itemId: `new-${level}-${take.length}`, text: body.prompt });
      }
      return { level, take, dropped, failure: result.failure };
    });
    const lesson = open && done.lesson.state === 'made' && !state.lesson ? done.lesson.lesson : null;
    const stored = plan.reduce((n,p) => n + p.take.length,0) + (lesson ? 1 : 0);
    const failure = [done.lesson.state === 'failed' ? done.lesson.failure : null,...plan.map(p => p.failure)].find(Boolean) ?? null;
    const complete = open && plan.every(p => !p.failure && state.counts[p.level - 1]! + p.take.length >= TARGET_PER_LEVEL) && (state.lesson || !!lesson);
    const note = !open ? 'topic_unavailable' : stored === 0 ? (failure ?? 'nothing_new') : complete ? null : 'partial';

    const digest = createHash('sha256').update(JSON.stringify({ lesson, questions: plan.map(p => p.take) })).digest('hex');
    // A request the model answered costs money whether or not anything was stored, so it counts against the monthly cap. One the model never answered
    // (a network error) costs nothing and does not.
    const answered = (done.usage!.inputTokens ?? 0) + (done.usage!.outputTokens ?? 0) > 0;
    const runId = await this.ai.logRun(client,actor,{ feature: 'topic.generate', templateVersion: `${draftingTemplateVersion}+${lessonTemplateVersion}`,
      provider: stored || answered ? done.usage!.provider : 'template', model: stored || answered ? done.usage!.model : null, source: stored || answered ? 'ai' : 'template', status: stored && !failure ? 'ok' : 'fallback',
      sourceRefs: { approvalId, indicatorId, grade, lesson: lesson ? 'made' : done.lesson.state, levels: plan.map(p => ({ level: p.level, added: p.take.length, dropped: p.dropped })) },
      digest, inputTokens: done.usage!.inputTokens, outputTokens: done.usage!.outputTokens, latencyMs: done.latencyMs, note });
    if (!stored) return summary(state.counts,{ generated: false, note, lesson: done.lesson.state, dropped: plan.map(p => p.dropped) });

    let setId = (await client.query("SELECT id FROM practice_sets WHERE school_id=$1 AND indicator_id=$2 AND source='generated' AND lower(grade)=lower($3) AND retired_at IS NULL",[actor.schoolId,indicatorId,grade])).rows[0]?.id as string | undefined;
    if (!setId) {
      setId = randomUUID();
      await client.query("INSERT INTO practice_sets(id,school_id,indicator_id,source,ai_run_id,grade) VALUES($1,$2,$3,'generated',$4,$5)",[setId,actor.schoolId,indicatorId,runId,grade]);
    }
    const counts = [...state.counts];
    for (const { level, take } of plan) {
      let position = state.maxPosition[level - 1]!;
      for (const q of take) {
        position++;
        await client.query('INSERT INTO practice_questions(id,school_id,set_id,level,position,kind,prompt,options,correct_option,answer_number,explanation,ai_run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [randomUUID(),actor.schoolId,setId,level,position,q.kind,q.prompt,q.options ? JSON.stringify(q.options) : null,q.correctOption,q.answer,q.explanation,runId]);
        counts[level - 1]!++;
      }
    }
    if (lesson) await client.query('INSERT INTO topic_lessons(id,school_id,indicator_id,grade,body,ai_run_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,indicatorId,grade,JSON.stringify(lesson),runId]);
    await audit(client,actor,'learning.generated',approvalId,{ indicatorId, grade, runId, lesson: lesson ? 'made' : done.lesson.state, added: plan.map(p => p.take.length), dropped: plan.map(p => p.dropped) });
    return summary(counts,{ generated: true, note, lesson: lesson ? 'made' : done.lesson.state, added: plan.map(p => p.take.length), dropped: plan.map(p => p.dropped) });
  }
}
