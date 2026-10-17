import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Actor } from '../../core/access';
import { AssessmentService } from '../assessment/assessment.service';
import { ProgressService, mean } from '../assessment/progress.service';
import { PlanDraftText, PlanFacts, attendanceWord, buildPlanPrompt, planDigest, planTemplateVersion, templatePlan, validatePlan } from './support-plan-draft';
import { AiService } from './ai.service';
import { LearnerFact, RemarkDraft, buildRemarksPrompt, factsFor, remarksDigest, remarksTemplateVersion, templateRemark, validateRemarks } from './report-remarks-draft';
import { IndicatorFact, WorksheetDraft, buildWorksheetPrompt, numbered, templateWorksheet, validateWorksheet, worksheetDigest, worksheetTemplateVersion } from './worksheet-draft';
import { BankQuestion } from '../practice/questions';
import { buildQuestionsPrompt, levelsDrafted, questionsDigest, questionsTemplateVersion, shuffleOptions, templateQuestions, validateQuestionsDraft } from './practice-questions-draft';

const CHUNK = 10;
type Usage = { provider: string; model: string | null; inputTokens: number | null; outputTokens: number | null };
const add = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);

// Report remarks and practice worksheets. Same three phases as the Nursery/KG draft: prepare (authorize, build facts, gate) inside a
// transaction, call the model with no transaction held, then log the run. Drafts are returned to the person and never saved by this service.
@Injectable()
export class AiDraftsService {
  constructor(private readonly ai: AiService, private readonly assessment: AssessmentService, private readonly progress: ProgressService) {}

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
    const note = await this.ai.gate(client,actor);
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
    return {fact,note:await this.ai.gate(client,actor)};
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

  // Home-practice questions for one indicator: the same indicator-only facts as a worksheet. The teacher edits and approves; nothing is saved here.
  prepareQuestions(client: PoolClient, actor: Actor, indicatorId: string) { return this.prepareWorksheet(client,actor,indicatorId); }

  async completeQuestions(prepared: Awaited<ReturnType<AiDraftsService['prepareQuestions']>>) {
    const started = Date.now(), provider = prepared.note ? null : this.ai.providerFor();
    const local = (note: string): { questions: BankQuestion[]; usage: Usage; source: 'template'; status: 'fallback'; note: string; latencyMs: number } =>
      ({questions:templateQuestions(),usage:{provider:'template',model:null,inputTokens:null,outputTokens:null},source:'template',status:'fallback',note,latencyMs:Date.now() - started});
    if (!provider) return local(prepared.note ?? 'no_provider');
    try {
      const result = await provider.complete(buildQuestionsPrompt(prepared.fact));
      const checked = validateQuestionsDraft(result.text);
      if (!checked.ok) return local(`rejected:${checked.reason}`);
      return {questions:shuffleOptions(checked.questions),usage:{provider:provider.name,model:provider.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens},source:'ai' as const,status:'ok' as const,note:null,latencyMs:Date.now() - started};
    } catch { return local('provider_error'); }
  }

  async recordQuestions(client: PoolClient, actor: Actor, indicatorId: string, done: Awaited<ReturnType<AiDraftsService['completeQuestions']>>) {
    const runId = await this.ai.logRun(client,actor,{feature:'practice.questions',templateVersion:questionsTemplateVersion,...done.usage,source:done.source,status:done.status,
      sourceRefs:{indicatorId,perLevel:levelsDrafted(done.questions)},digest:questionsDigest(done.questions),latencyMs:done.latencyMs,note:done.note});
    return {runId,source:done.source,status:done.status,note:done.note,questions:done.questions};
  }

  // A support plan for named learners in one subject (and optionally one topic), drafted from their term data.
  async preparePlan(client: PoolClient, actor: Actor, body: { classId: string; termId: string; subjectId: string; indicatorId?: string; learnerIds: string[] }) {
    const sheet = await this.progress.caSheet(client,actor,body.classId,body.termId,body.subjectId); // authorizes the class (assigned teacher or head)
    const inClass = new Map(sheet.items.filter(i => !i.left).map(i => [i.learnerId,i]));
    const ids = [...new Set(body.learnerIds)];
    if (!ids.length || ids.some(id => !inClass.has(id))) throw new BadRequestException('Choose learners from this class');
    const topic = body.indicatorId ? (await client.query('SELECT description FROM curriculum_indicators WHERE school_id=$1 AND id=$2 AND subject_id=$3',[actor.schoolId,body.indicatorId,body.subjectId])).rows[0] : null;
    if (body.indicatorId && !topic) throw new NotFoundException('Topic unavailable');
    const practice = body.indicatorId ? (await client.query('SELECT title FROM indicator_resources WHERE school_id=$1 AND indicator_id=$2 AND retired_at IS NULL ORDER BY created_at LIMIT 5',[actor.schoolId,body.indicatorId])).rows.map(r => r.title as string) : [];
    const gaps = (await this.progress.gaps(client,actor,body.classId,body.termId,body.subjectId)).items;
    const term = await this.assessment.term(client,actor.schoolId,body.termId);
    const attendance = new Map((await client.query(`SELECT m.learner_id,count(*) FILTER (WHERE m.mark<>'unmarked')::int AS marked,count(*) FILTER (WHERE m.mark IN ('present','late'))::int AS present
      FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id AND r.status IN ('submitted','locked')
      WHERE m.school_id=$1 AND m.learner_id=ANY($2::uuid[]) AND r.day BETWEEN $3::date AND $4::date GROUP BY m.learner_id`,[actor.schoolId,ids,term.start_date,term.end_date])).rows.map(r => [r.learner_id as string,r]));
    // Up to 15 learners are described to the model; a larger group is summarised from its first 15 (weakest first).
    const ordered = ids.map(id => inClass.get(id)!).sort((a,b) => (a.ca ?? 101) - (b.ca ?? 101)).slice(0,15);
    const learners = [];
    for (const [i,row] of ordered.entries()) {
      const own = (await this.progress.learnerTerm(client,actor,row.learnerId,body.termId)).subjects.find(s => s.subjectId === body.subjectId);
      const marks = sheet.items.find(x => x.learnerId === row.learnerId)!;
      const att = attendance.get(row.learnerId);
      learners.push({key:`L${i + 1}`,learnerId:row.learnerId,exercises:marks.parts.exercises?.average ?? null,homework:marks.parts.homework?.average ?? null,tests:marks.parts.tests?.average ?? null,
        recent:own?.recent ?? null,earlier:own?.attention?.earlier ?? null,
        trend:own?.attention ? own.attention.reason : (own?.marks ?? 0) >= 3 ? 'steady' as const : 'not_enough' as const,
        missedWork:own ? Object.values(own.parts).reduce((n,p) => n + Math.max(0,p.set - p.marked),0) : 0,examGap:own?.gap?.direction ?? null,
        attendance:attendanceWord(att?.present ?? 0,att?.marked ?? 0),
        weakTopics:gaps.filter(g => g.below.some(b => b.learnerId === row.learnerId)).sort((a,b) => (a.below.find(x => x.learnerId === row.learnerId)!.average) - (b.below.find(x => x.learnerId === row.learnerId)!.average)).slice(0,2).map(g => g.description)});
    }
    const facts: PlanFacts = {subject:sheet.subject.name,className:sheet.class.name,topic:topic?.description ?? null,classAverage:mean(sheet.items.filter(i => !i.left && i.ca !== null).map(i => i.ca!)),practice,learners};
    return {facts,note:await this.ai.gate(client,actor)};
  }

  async completePlan(prepared: Awaited<ReturnType<AiDraftsService['preparePlan']>>) {
    const started = Date.now(), provider = prepared.note ? null : this.ai.providerFor();
    const local = (note: string): { draft: PlanDraftText; usage: Usage; source: 'template'; status: 'fallback'; note: string; latencyMs: number } =>
      ({draft:templatePlan(prepared.facts),usage:{provider:'template',model:null,inputTokens:null,outputTokens:null},source:'template',status:'fallback',note,latencyMs:Date.now() - started});
    if (!provider) return local(prepared.note ?? 'no_provider');
    try {
      const result = await provider.complete(buildPlanPrompt(prepared.facts));
      const checked = validatePlan(result.text);
      if (!checked.ok) return local(`rejected:${checked.reason}`);
      return {draft:checked.draft,usage:{provider:provider.name,model:provider.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens},source:'ai' as const,status:'ok' as const,note:null,latencyMs:Date.now() - started};
    } catch { return local('provider_error'); }
  }

  async recordPlan(client: PoolClient, actor: Actor, body: { classId: string; termId: string; subjectId: string; indicatorId?: string }, prepared: Awaited<ReturnType<AiDraftsService['preparePlan']>>, done: Awaited<ReturnType<AiDraftsService['completePlan']>>) {
    const runId = await this.ai.logRun(client,actor,{feature:'support.plan',templateVersion:planTemplateVersion,...done.usage,source:done.source,status:done.status,
      sourceRefs:{classId:body.classId,termId:body.termId,subjectId:body.subjectId,indicatorId:body.indicatorId ?? null,learnerIds:prepared.facts.learners.map(l => l.learnerId)},digest:planDigest(done.draft),latencyMs:done.latencyMs,note:done.note});
    return {runId,source:done.source,status:done.status,note:done.note,...done.draft,
      basis:prepared.facts.learners.map(l => ({learnerId:l.learnerId,recent:l.recent,trend:l.trend,missedWork:l.missedWork,examGap:l.examGap,attendance:l.attendance,weakTopics:l.weakTopics}))};
  }
}
