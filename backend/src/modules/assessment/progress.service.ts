import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { AddIndicatorsDto, ClassAssessmentDto, RecordMarksDto, ResourceDto, RetireIndicatorDto } from './assessment.dto';
import { AssessmentService, CaParts, DEFAULT_CA_PARTS, weightedTotal } from './assessment.service';

type Mark = { assessment_id: string; learner_id: string; subject_id: string; kind: string; held_on: string; percent: number };
// A learner needs attention in a subject when their last few marks average below the pass line,
// or fall well below their own earlier marks this term.
export const RECENT = 3, PASS_LINE = 50, DROP = 10;
const round1 = (n: number) => Math.round(n * 10) / 10;
export const mean = (values: number[]) => values.length ? round1(values.reduce((sum, v) => sum + v, 0) / values.length) : null;

// Marks oldest first; returns why a learner needs attention, or null.
export function attentionFor(percents: number[]) {
  if (percents.length < RECENT) return null;
  const recent = mean(percents.slice(-RECENT))!, earlier = mean(percents.slice(0, -RECENT));
  if (earlier !== null && recent <= earlier - DROP) return { reason: 'dropping' as const, recent, earlier };
  if (recent < PASS_LINE) return { reason: 'below_pass' as const, recent, earlier };
  return null;
}

// Continuous assessment from parts: class exercises (quizzes count with them), homework, class tests and projects, each
// weighted by the school's share. A part the learner has no marks in, or that the school weights at 0, is left out and
// the other parts are scaled up, so a missed homework is visible on the sheet but does not silently count as zero.
export const CA_PARTS = ['exercises','homework','tests','projects'] as const;
export type CaPart = typeof CA_PARTS[number];
export const partOf = (kind: string): CaPart | null => kind === 'classwork' || kind === 'quiz' ? 'exercises' : kind === 'homework' ? 'homework' : kind === 'class_test' ? 'tests' : kind === 'project' ? 'projects' : null;
export function caFromParts(averages: Partial<Record<CaPart, number | null>>, parts: CaParts) {
  let weight = 0, sum = 0;
  for (const part of CA_PARTS) { const average = averages[part]; if (average === null || average === undefined || !parts[part]) continue; weight += parts[part]; sum += average * parts[part]; }
  return weight ? round1(sum / weight) : null;
}
// Class work and the exam far apart (20+ points either way, with at least 3 class-work marks) is worth a look:
// the learner may have had a bad or unusually good exam day, been absent from class work, or worked with help.
export const EXAM_GAP = 20, GAP_MIN_MARKS = 3;
export function examGap(classWork: number | null, exam: number | null, marks: number) {
  if (classWork === null || exam === null || marks < GAP_MIN_MARKS) return null;
  const difference = round1(exam - classWork);
  return Math.abs(difference) >= EXAM_GAP ? {direction:difference > 0 ? 'exam_higher' as const : 'exam_lower' as const,difference} : null;
}

@Injectable()
export class ProgressService {
  constructor(private readonly assessment: AssessmentService) {}

  // Latest mark per learner for each assessment, as a percentage of its maximum. Class work only unless asked:
  // mock exams are kept apart from trends, the CA suggestion and gaps.
  private async marks(client: PoolClient, schoolId: string, where: string, params: unknown[], withMocks = false) {
    return (await client.query(`SELECT a.id AS assessment_id,m.learner_id,a.subject_id,a.kind,a.held_on::text,round(m.mark*100/a.max_mark,1)::float AS percent
      FROM class_assessments a JOIN LATERAL (SELECT DISTINCT ON (x.learner_id) x.learner_id,x.mark FROM class_assessment_marks x
        WHERE x.school_id=a.school_id AND x.assessment_id=a.id ORDER BY x.learner_id,x.created_at DESC,x.id DESC) m ON true
      WHERE a.school_id=$1 AND ${where} AND (${withMocks} OR a.kind<>'mock') ORDER BY a.held_on,a.created_at,a.id`,[schoolId,...params])).rows as Mark[];
  }

  create(client: PoolClient, actor: Actor, classId: string, body: ClassAssessmentDto) {
    return command(client,actor,body.operationId,'assessment.class_assessment',{classId,...body},async () => {
      await this.assessment.classFor(client,actor,classId);
      const term = await this.assessment.term(client,actor.schoolId,body.termId);
      if (body.heldOn < term.start_date || body.heldOn > term.end_date) throw new BadRequestException('The assessment date must fall inside the term');
      if (!(await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2',[actor.schoolId,body.subjectId])).rowCount) throw new NotFoundException('Subject unavailable');
      const indicatorIds = [...new Set(body.indicatorIds ?? [])];
      if (indicatorIds.length && (await client.query('SELECT 1 FROM curriculum_indicators WHERE school_id=$1 AND id=ANY($2::uuid[]) AND subject_id=$3 AND retired_at IS NULL',[actor.schoolId,indicatorIds,body.subjectId])).rowCount !== indicatorIds.length)
        throw new BadRequestException('Choose current indicators from this subject');
      const row = (await client.query(`INSERT INTO class_assessments(id,school_id,term_id,class_id,subject_id,kind,title,held_on,max_mark,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id,kind,title,held_on::text,max_mark::float`,[randomUUID(),actor.schoolId,body.termId,classId,body.subjectId,body.kind,body.title.trim(),body.heldOn,body.maxMark,actor.membershipId])).rows[0];
      for (const indicatorId of indicatorIds) await client.query('INSERT INTO class_assessment_indicators(school_id,assessment_id,indicator_id) VALUES($1,$2,$3)',[actor.schoolId,row.id,indicatorId]);
      await audit(client,actor,'assessment.class_assessment.created',row.id,{classId,termId:body.termId,subjectId:body.subjectId,indicators:indicatorIds.length});
      return {...row,indicators:indicatorIds.length};
    });
  }

  async list(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId?: string) {
    await this.assessment.classFor(client,actor,classId);
    const marks = await this.marks(client,actor.schoolId,'a.class_id=$2 AND a.term_id=$3',[classId,termId],true);
    const rows = (await client.query(`SELECT a.id,a.subject_id,s.name AS subject_name,a.kind,a.title,a.held_on::text,a.max_mark::float FROM class_assessments a JOIN subjects s ON s.school_id=a.school_id AND s.id=a.subject_id
      WHERE a.school_id=$1 AND a.class_id=$2 AND a.term_id=$3 AND ($4::uuid IS NULL OR a.subject_id=$4) ORDER BY a.held_on DESC,a.created_at DESC,a.id`,[actor.schoolId,classId,termId,subjectId ?? null])).rows;
    const tags = (await client.query(`SELECT x.assessment_id,i.id,i.code,i.description FROM class_assessment_indicators x JOIN curriculum_indicators i ON i.school_id=x.school_id AND i.id=x.indicator_id
      WHERE x.school_id=$1 AND x.assessment_id=ANY($2::uuid[]) ORDER BY i.code NULLS LAST,i.description`,[actor.schoolId,rows.map(row => row.id)])).rows;
    return {items:rows.map(row => { const own = marks.filter(m => m.assessment_id === row.id).map(m => m.percent);
      return {...row,marked:own.length,average:mean(own),indicators:tags.filter(t => t.assessment_id === row.id).map(t => ({id:t.id,code:t.code,description:t.description}))}; })};
  }

  private async assessmentIn(client: PoolClient, actor: Actor, classId: string, assessmentId: string) {
    await this.assessment.classFor(client,actor,classId);
    const row = (await client.query(`SELECT a.id,a.term_id,a.subject_id,a.kind,a.title,a.held_on::text,a.max_mark::float,t.start_date::text,t.end_date::text FROM class_assessments a
      JOIN terms t ON t.school_id=a.school_id AND t.id=a.term_id WHERE a.school_id=$1 AND a.class_id=$2 AND a.id=$3`,[actor.schoolId,classId,assessmentId])).rows[0];
    if (!row) throw new NotFoundException('Assessment unavailable');
    return row;
  }

  async roster(client: PoolClient, actor: Actor, classId: string, assessmentId: string) {
    const a = await this.assessmentIn(client,actor,classId,assessmentId);
    const learners = await this.assessment.learners(client,actor.schoolId,classId,a);
    const latest = new Map((await client.query('SELECT DISTINCT ON (learner_id) learner_id,mark::float FROM class_assessment_marks WHERE school_id=$1 AND assessment_id=$2 ORDER BY learner_id,created_at DESC,id DESC',[actor.schoolId,assessmentId])).rows.map(row => [row.learner_id as string,row.mark as number]));
    return {assessment:{id:a.id,kind:a.kind,title:a.title,held_on:a.held_on,max_mark:a.max_mark},items:learners.map(l => ({learnerId:l.id,fullName:l.full_name,left:l.left,mark:latest.get(l.id) ?? null}))};
  }

  recordMarks(client: PoolClient, actor: Actor, classId: string, assessmentId: string, body: RecordMarksDto) {
    return command(client,actor,body.operationId,'assessment.class_assessment.marks',{classId,assessmentId,...body},async () => {
      const a = await this.assessmentIn(client,actor,classId,assessmentId);
      if (new Set(body.marks.map(m => m.learnerId)).size !== body.marks.length) throw new BadRequestException('Each learner may appear once');
      if (body.marks.some(m => m.mark > a.max_mark)) throw new BadRequestException(`Marks cannot be more than ${a.max_mark}`);
      const eligible = new Set((await this.assessment.learners(client,actor.schoolId,classId,a)).map(l => l.id));
      if (body.marks.some(m => !eligible.has(m.learnerId))) throw new NotFoundException('A learner is not in this class for the term');
      const current = new Map((await client.query('SELECT DISTINCT ON (learner_id) learner_id,mark::float FROM class_assessment_marks WHERE school_id=$1 AND assessment_id=$2 ORDER BY learner_id,created_at DESC,id DESC',[actor.schoolId,assessmentId])).rows.map(row => [row.learner_id as string,row.mark as number]));
      let written = 0;
      for (const m of body.marks) {
        if (current.get(m.learnerId) === m.mark) continue;
        await client.query('INSERT INTO class_assessment_marks(id,school_id,assessment_id,learner_id,mark,recorded_by) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,assessmentId,m.learnerId,m.mark,actor.membershipId]);
        written++;
      }
      await audit(client,actor,'assessment.class_assessment.marked',assessmentId,{classId,written});
      return {written,unchanged:body.marks.length - written};
    }).catch(error => { if ((error as {code?:string}).code === '23514') throw new ConflictException((error as Error).message); throw error; });
  }

  // Suggested continuous assessment score from the term's class work, weighted by the school's CA parts.
  // The teacher reviews it and saves it as the CA score themselves.
  async caSuggestion(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId: string) {
    await this.assessment.classFor(client,actor,classId);
    const parts = (await this.assessment.policy(client,actor.schoolId))?.ca_parts ?? DEFAULT_CA_PARTS;
    const marks = await this.marks(client,actor.schoolId,'a.class_id=$2 AND a.term_id=$3 AND a.subject_id=$4',[classId,termId,subjectId]);
    const learners = [...new Set(marks.map(m => m.learner_id))];
    return {parts,items:learners.map(learnerId => { const own = marks.filter(m => m.learner_id === learnerId);
      return {learnerId,ca:caFromParts(partAverages(own),parts),assessments:own.length}; })};
  }

  // The CA sheet for one subject: each learner's class exercises, homework and class tests (each test on its own), the CA
  // they make under the school's parts, the CA and exam recorded for the report, the total, and class work far from the exam.
  async caSheet(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId: string) {
    const grid = await this.assessment.grid(client,actor,classId,termId,subjectId);
    const subject = (await client.query('SELECT id,name FROM subjects WHERE school_id=$1 AND id=$2',[actor.schoolId,subjectId])).rows[0];
    if (!subject) throw new NotFoundException('Subject unavailable');
    const policy = grid.policy, parts = policy?.ca_parts ?? DEFAULT_CA_PARTS;
    const assessments = (await client.query(`SELECT id,kind,title,held_on::text,max_mark::float FROM class_assessments WHERE school_id=$1 AND class_id=$2 AND term_id=$3 AND subject_id=$4 AND kind<>'mock'
      ORDER BY held_on,created_at,id`,[actor.schoolId,classId,termId,subjectId])).rows as { id: string; kind: string; title: string; held_on: string; max_mark: number }[];
    const marks = await this.marks(client,actor.schoolId,'a.class_id=$2 AND a.term_id=$3 AND a.subject_id=$4',[classId,termId,subjectId]);
    const set = Object.fromEntries(CA_PARTS.map(part => [part,assessments.filter(a => partOf(a.kind) === part).length])) as Record<CaPart, number>;
    const tests = assessments.filter(a => a.kind === 'class_test');
    const items = grid.items.map(l => {
      const own = marks.filter(m => m.learner_id === l.learnerId), averages = partAverages(own);
      const ca = caFromParts(averages,parts), recordedCa = l.ca;
      const caForTotal = recordedCa ?? ca;
      return {learnerId:l.learnerId,fullName:l.fullName,left:l.left,locked:l.locked,
        parts:Object.fromEntries(CA_PARTS.map(part => [part,{average:averages[part] ?? null,marked:own.filter(m => partOf(m.kind) === part).length}])),
        tests:tests.map(t => own.find(m => m.assessment_id === t.id)?.percent ?? null),
        ca,recordedCa,exam:l.exam,
        total:policy && caForTotal !== null && l.exam !== null ? weightedTotal(caForTotal,l.exam,policy) : null,
        gap:examGap(ca ?? recordedCa,l.exam,own.length)};
    });
    return {class:grid.class,term:grid.term,subject,policy:policy ? {caWeight:policy.ca_weight,examWeight:policy.exam_weight,parts,sourceNote:policy.source_note} : null,
      set,tests:tests.map(t => ({id:t.id,title:t.title,held_on:t.held_on,max_mark:t.max_mark})),items};
  }

  // One learner's term, subject by subject, as on the CA sheet: class work by part (marked of set), the CA it makes, the CA
  // and exam recorded, the total, an exam far from class work, and whether recent marks need attention.
  async learnerTerm(client: PoolClient, actor: Actor, learnerId: string, termId: string) {
    const term = await this.assessment.term(client,actor.schoolId,termId);
    const policy = await this.assessment.policy(client,actor.schoolId), parts = policy?.ca_parts ?? DEFAULT_CA_PARTS;
    const marks = await this.marks(client,actor.schoolId,'a.term_id=$2 AND m.learner_id=$3',[termId,learnerId]);
    const set = (await client.query(`SELECT a.subject_id,a.kind,count(*)::int AS n FROM class_assessments a WHERE a.school_id=$1 AND a.term_id=$2 AND a.kind<>'mock'
      AND a.class_id IN (SELECT e.class_id FROM enrolments e WHERE e.school_id=$1 AND e.learner_id=$3 AND e.superseded_at IS NULL AND e.start_date<$5 AND (e.end_date IS NULL OR e.end_date>$4))
      GROUP BY a.subject_id,a.kind`,[actor.schoolId,termId,learnerId,term.start_date,term.end_date])).rows as { subject_id: string; kind: string; n: number }[];
    const scores = (await client.query(`SELECT DISTINCT ON (subject_id,kind) subject_id,kind,score::float AS score FROM assessment_score_entries WHERE school_id=$1 AND term_id=$2 AND learner_id=$3
      ORDER BY subject_id,kind,created_at DESC,id DESC`,[actor.schoolId,termId,learnerId])).rows as { subject_id: string; kind: string; score: number }[];
    const ids = [...new Set([...marks.map(m => m.subject_id),...set.map(r => r.subject_id),...scores.map(r => r.subject_id)])];
    const subjects = (await client.query('SELECT id,name FROM subjects WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY name',[actor.schoolId,ids])).rows as { id: string; name: string }[];
    return {term:{id:term.id,name:term.name,start_date:term.start_date,end_date:term.end_date},policy:policy ? {caWeight:policy.ca_weight,examWeight:policy.exam_weight,parts} : null,
      subjects:subjects.map(s => {
        const own = marks.filter(m => m.subject_id === s.id), averages = partAverages(own), ca = caFromParts(averages,parts);
        const recordedCa = scores.find(r => r.subject_id === s.id && r.kind === 'ca')?.score ?? null, exam = scores.find(r => r.subject_id === s.id && r.kind === 'exam')?.score ?? null;
        const caForTotal = recordedCa ?? ca;
        return {subjectId:s.id,name:s.name,
          parts:Object.fromEntries(CA_PARTS.map(part => [part,{average:averages[part],marked:own.filter(m => partOf(m.kind) === part).length,
            set:set.filter(r => r.subject_id === s.id && partOf(r.kind) === part).reduce((n,r) => n + r.n,0)}])),
          classWork:mean(own.map(m => m.percent)),recent:own.length >= RECENT ? mean(own.slice(-RECENT).map(m => m.percent)) : null,marks:own.length,lastMarked:own.length ? own[own.length - 1]!.held_on : null,
          ca,recordedCa,exam,total:policy && caForTotal !== null && exam !== null ? weightedTotal(caForTotal,exam,policy) : null,
          gap:examGap(ca ?? recordedCa,exam,own.length),attention:attentionFor(own.map(m => m.percent))};
      })};
  }

  // How much class work has been set: per subject, the number of exercises, homework, class tests and projects this week,
  // this month and this term (counted up to today, or the term's last day once it has ended).
  async workload(client: PoolClient, actor: Actor, classId: string, termId: string) {
    await this.assessment.classFor(client,actor,classId);
    const term = await this.assessment.term(client,actor.schoolId,termId);
    const today = (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS today")).rows[0].today as string;
    const day = today > term.end_date ? term.end_date : today < term.start_date ? term.start_date : today;
    const week = mondayOf(day), month = day.slice(0,7);
    const rows = (await client.query(`SELECT a.subject_id,s.name,a.kind,a.held_on::text FROM class_assessments a JOIN subjects s ON s.school_id=a.school_id AND s.id=a.subject_id
      WHERE a.school_id=$1 AND a.class_id=$2 AND a.term_id=$3 AND a.kind<>'mock' AND a.held_on<=$4 ORDER BY s.name`,[actor.schoolId,classId,termId,day])).rows as { subject_id: string; name: string; kind: string; held_on: string }[];
    const count = (list: typeof rows) => Object.fromEntries(CA_PARTS.map(part => [part,list.filter(r => partOf(r.kind) === part).length])) as Record<CaPart, number>;
    const subjects = [...new Map(rows.map(r => [r.subject_id,r.name])).entries()];
    const summarise = (list: typeof rows) => ({week:count(list.filter(r => r.held_on >= week)),month:count(list.filter(r => r.held_on.startsWith(month))),term:count(list)});
    return {asOf:day,weekStart:week,items:subjects.map(([subjectId,name]) => ({subjectId,name,...summarise(rows.filter(r => r.subject_id === subjectId))})),all:summarise(rows)};
  }

  // Class average per subject for each week or month of the term, and the learners who need attention.
  async classProgress(client: PoolClient, actor: Actor, classId: string, termId: string, period: 'week' | 'month') {
    const section = await this.assessment.classFor(client,actor,classId), term = await this.assessment.term(client,actor.schoolId,termId);
    const marks = await this.marks(client,actor.schoolId,'a.class_id=$2 AND a.term_id=$3',[classId,termId]);
    const learners = await this.assessment.learners(client,actor.schoolId,classId,term);
    const subjects = (await client.query('SELECT id,name FROM subjects WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY name',[actor.schoolId,[...new Set(marks.map(m => m.subject_id))]])).rows as { id: string; name: string }[];
    const bucketOf = (day: string) => period === 'month' ? `${day.slice(0,7)}-01` : mondayOf(day);
    const buckets = [...new Set(marks.map(m => bucketOf(m.held_on)))].sort();
    const series = subjects.map(s => ({subjectId:s.id,name:s.name,points:buckets.map(start => { const p = marks.filter(m => m.subject_id === s.id && bucketOf(m.held_on) === start).map(m => m.percent); return {start,average:mean(p),marks:p.length}; })}));
    const overall = buckets.map(start => { const own = marks.filter(m => bucketOf(m.held_on) === start); return {start,average:mean(own.map(m => m.percent)),learners:new Set(own.map(m => m.learner_id)).size}; });
    const attention = learners.filter(l => !l.left).flatMap(l => subjects.flatMap(s => {
      const flag = attentionFor(marks.filter(m => m.learner_id === l.id && m.subject_id === s.id).map(m => m.percent));
      return flag ? [{learnerId:l.id,fullName:l.full_name,subjectId:s.id,subject:s.name,...flag}] : [];
    }));
    return {class:section,term,period,classSize:learners.filter(l => !l.left).length,buckets,overall,subjects:series,attention};
  }

  // Indicators for a subject (or all), current ones first; retired ones stay listed with why.
  async indicators(client: PoolClient, schoolId: string, subjectId?: string) {
    return {items:(await client.query(`SELECT i.id,i.subject_id,s.name AS subject_name,i.code,i.strand,i.sub_strand,i.description,i.grade,i.origin,i.source_note,i.retired_at,i.retirement_reason
      FROM curriculum_indicators i JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id WHERE i.school_id=$1 AND ($2::uuid IS NULL OR i.subject_id=$2)
      ORDER BY s.name,i.retired_at IS NOT NULL,i.grade NULLS FIRST,i.code NULLS LAST,i.created_at,i.id`,[schoolId,subjectId ?? null])).rows};
  }
  addIndicators(client: PoolClient, actor: Actor, body: AddIndicatorsDto) {
    return command(client,actor,body.operationId,'assessment.indicators',body,async () => {
      if (!(await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2',[actor.schoolId,body.subjectId])).rowCount) throw new NotFoundException('Subject unavailable');
      const codes = body.items.map(item => item.code?.trim().toLowerCase()).filter(Boolean);
      if (new Set(codes).size !== codes.length) throw new BadRequestException('Each code may appear once');
      if (codes.length && (await client.query('SELECT 1 FROM curriculum_indicators WHERE school_id=$1 AND subject_id=$2 AND retired_at IS NULL AND lower(code)=ANY($3::text[])',[actor.schoolId,body.subjectId,codes])).rowCount)
        throw new ConflictException('An indicator with one of these codes is already in use for this subject. Retire it first');
      for (const item of body.items) await client.query(`INSERT INTO curriculum_indicators(id,school_id,subject_id,code,strand,sub_strand,description,origin,source_note,created_by,grade) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [randomUUID(),actor.schoolId,body.subjectId,item.code?.trim() || null,item.strand?.trim() || null,item.subStrand?.trim() || null,item.description.trim(),body.origin,body.sourceNote.trim(),actor.membershipId,body.grade?.trim() || null]);
      await audit(client,actor,'assessment.indicators.added',body.subjectId,{added:body.items.length,origin:body.origin,grade:body.grade?.trim() || null});
      return {added:body.items.length};
    });
  }
  retireIndicator(client: PoolClient, actor: Actor, indicatorId: string, body: RetireIndicatorDto) {
    return command(client,actor,body.operationId,'assessment.indicator.retire',{indicatorId,...body},async () => {
      const row = (await client.query('UPDATE curriculum_indicators SET retired_at=now(),retired_by=$3,retirement_reason=$4 WHERE school_id=$1 AND id=$2 AND retired_at IS NULL RETURNING id',[actor.schoolId,indicatorId,actor.membershipId,body.reason.trim()])).rows[0];
      if (!row) throw new NotFoundException('Indicator unavailable or already retired');
      await audit(client,actor,'assessment.indicator.retired',indicatorId,{reason:body.reason.trim()});
      return {retired:true};
    });
  }

  // Practice materials for an indicator, current ones first.
  async resources(client: PoolClient, actor: Actor, indicatorId: string) {
    const indicator = (await client.query('SELECT code,description,retired_at FROM curriculum_indicators WHERE school_id=$1 AND id=$2',[actor.schoolId,indicatorId])).rows[0];
    if (!indicator) throw new NotFoundException('Indicator unavailable');
    return {indicator,canRetireAny:actor.role === 'headteacher',items:(await client.query(`SELECT id,kind,title,detail,url,for_families,created_by=$3 AS mine,created_at,retired_at,retirement_reason FROM indicator_resources
      WHERE school_id=$1 AND indicator_id=$2 ORDER BY retired_at IS NOT NULL,created_at,id`,[actor.schoolId,indicatorId,actor.membershipId])).rows};
  }
  addResource(client: PoolClient, actor: Actor, indicatorId: string, body: ResourceDto) {
    return command(client,actor,body.operationId,'assessment.indicator_resource',{indicatorId,...body},async () => {
      if (!(await client.query('SELECT 1 FROM curriculum_indicators WHERE school_id=$1 AND id=$2 AND retired_at IS NULL',[actor.schoolId,indicatorId])).rowCount) throw new NotFoundException('Indicator unavailable or retired');
      if (!body.detail?.trim() && !body.url) throw new BadRequestException('Give the pages, instructions or a link');
      const row = (await client.query(`INSERT INTO indicator_resources(id,school_id,indicator_id,kind,title,detail,url,for_families,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [randomUUID(),actor.schoolId,indicatorId,body.kind,body.title.trim(),body.detail?.trim() || null,body.url || null,body.forFamilies ?? false,actor.membershipId])).rows[0];
      await audit(client,actor,'assessment.indicator_resource.added',row.id,{indicatorId,kind:body.kind});
      return row;
    });
  }
  // The headteacher, or whoever added it, may retire a practice material.
  retireResource(client: PoolClient, actor: Actor, resourceId: string, body: RetireIndicatorDto) {
    return command(client,actor,body.operationId,'assessment.indicator_resource.retire',{resourceId,...body},async () => {
      const row = (await client.query('SELECT created_by,retired_at FROM indicator_resources WHERE school_id=$1 AND id=$2',[actor.schoolId,resourceId])).rows[0];
      if (!row || row.retired_at) throw new NotFoundException('Practice material unavailable or already retired');
      if (actor.role !== 'headteacher' && row.created_by !== actor.membershipId) throw new ForbiddenException('Only the headteacher or the person who added it can retire this');
      await client.query('UPDATE indicator_resources SET retired_at=now(),retired_by=$3,retirement_reason=$4 WHERE school_id=$1 AND id=$2',[actor.schoolId,resourceId,actor.membershipId,body.reason.trim()]);
      await audit(client,actor,'assessment.indicator_resource.retired',resourceId,{reason:body.reason.trim()});
      return {retired:true};
    });
  }

  // Each indicator tested in the class this term, weakest first: the class average (each learner's average over the
  // indicator's assessments, every learner counting once) and who is below the pass line on it.
  async gaps(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId?: string) {
    await this.assessment.classFor(client,actor,classId);
    const term = await this.assessment.term(client,actor.schoolId,termId);
    const marks = await this.marks(client,actor.schoolId,'a.class_id=$2 AND a.term_id=$3',[classId,termId]);
    const links = (await client.query(`SELECT x.assessment_id,i.id,i.subject_id,s.name AS subject_name,i.code,i.strand,i.sub_strand,i.description,i.origin FROM class_assessment_indicators x
      JOIN class_assessments a ON a.school_id=x.school_id AND a.id=x.assessment_id JOIN curriculum_indicators i ON i.school_id=x.school_id AND i.id=x.indicator_id
      JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE x.school_id=$1 AND a.class_id=$2 AND a.term_id=$3 AND ($4::uuid IS NULL OR i.subject_id=$4)`,[actor.schoolId,classId,termId,subjectId ?? null])).rows;
    const names = new Map((await this.assessment.learners(client,actor.schoolId,classId,term)).map(l => [l.id,l.full_name]));
    const indicators = new Map<string, typeof links[number]>(); for (const link of links) indicators.set(link.id,link);
    const items = [...indicators.values()].map(i => {
      const assessmentIds = new Set(links.filter(l => l.id === i.id).map(l => l.assessment_id as string));
      const own = marks.filter(m => assessmentIds.has(m.assessment_id));
      const learners = [...new Set(own.map(m => m.learner_id))].map(learnerId => ({learnerId,fullName:names.get(learnerId) ?? '',average:mean(own.filter(m => m.learner_id === learnerId).map(m => m.percent))!}));
      const below = learners.filter(l => l.average < PASS_LINE).sort((a,b) => a.average - b.average);
      return {indicatorId:i.id,subjectId:i.subject_id,subject:i.subject_name,code:i.code,strand:i.strand,subStrand:i.sub_strand,description:i.description,origin:i.origin,
        assessments:assessmentIds.size,learners:learners.length,average:mean(learners.map(l => l.average)),belowPass:below.length,belowShare:learners.length ? Math.round(below.length * 100 / learners.length) : null,below};
    }).filter(i => i.learners > 0).sort((a,b) => a.average! - b.average! || (a.code ?? '').localeCompare(b.code ?? ''));
    const counts = new Map((await client.query('SELECT indicator_id,count(*)::int AS n FROM indicator_resources WHERE school_id=$1 AND indicator_id=ANY($2::uuid[]) AND retired_at IS NULL GROUP BY indicator_id',
      [actor.schoolId,items.map(i => i.indicatorId)])).rows.map(r => [r.indicator_id as string,r.n as number]));
    for (const item of items) (item as typeof item & { resources: number }).resources = counts.get(item.indicatorId) ?? 0;
    const tagged = new Set(links.map(l => l.assessment_id as string));
    const untagged = (await client.query('SELECT count(*)::int AS n FROM class_assessments WHERE school_id=$1 AND class_id=$2 AND term_id=$3 AND ($4::uuid IS NULL OR subject_id=$4)',[actor.schoolId,classId,termId,subjectId ?? null])).rows[0].n - tagged.size;
    return {items,untaggedAssessments:untagged};
  }

  // Heads see any learner; teachers see learners enrolled today in a class they are live-assigned to.
  async learnerFor(client: PoolClient, actor: Actor, learnerId: string) {
    const learner = (await client.query('SELECT id,full_name,admission_number FROM learners WHERE school_id=$1 AND id=$2',[actor.schoolId,learnerId])).rows[0];
    if (!learner) throw new NotFoundException('Learner unavailable');
    if (actor.role === 'teacher') {
      const live = await client.query(`SELECT 1 FROM enrolments e JOIN teaching_assignments t ON t.school_id=e.school_id AND t.class_id=e.class_id
        WHERE e.school_id=$1 AND e.learner_id=$2 AND e.superseded_at IS NULL AND e.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND (e.end_date IS NULL OR e.end_date>(now() AT TIME ZONE 'Africa/Accra')::date)
        AND t.teacher_membership_id=$3 AND t.revoked_at IS NULL AND t.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND t.end_date>(now() AT TIME ZONE 'Africa/Accra')::date`,[actor.schoolId,learnerId,actor.membershipId]);
      if (!live.rowCount) throw new NotFoundException('Learner unavailable');
    }
    return learner;
  }

  // One learner's subjects over time. Week and month come from dated assessments; term and year also carry
  // the term result (CA and exam weighted by the school's policy), so term-on-term and year-on-year compare.
  async learnerProgress(client: PoolClient, actor: Actor, learnerId: string, period: 'week' | 'month' | 'term' | 'year') {
    const learner = await this.learnerFor(client,actor,learnerId);
    const marks = (await client.query(`SELECT a.subject_id,a.held_on::text,a.term_id,t.academic_year_id,round(m.mark*100/a.max_mark,1)::float AS percent
      FROM class_assessments a JOIN terms t ON t.school_id=a.school_id AND t.id=a.term_id
      JOIN LATERAL (SELECT x.mark FROM class_assessment_marks x WHERE x.school_id=a.school_id AND x.assessment_id=a.id AND x.learner_id=$2 ORDER BY x.created_at DESC,x.id DESC LIMIT 1) m ON true
      WHERE a.school_id=$1 AND a.kind<>'mock' ORDER BY a.held_on,a.created_at,a.id`,[actor.schoolId,learnerId])).rows as { subject_id: string; held_on: string; term_id: string; academic_year_id: string; percent: number }[];
    const policy = await this.assessment.policy(client,actor.schoolId);
    const scores = (await client.query(`SELECT DISTINCT ON (term_id,subject_id,kind) term_id,subject_id,kind,score::float AS score FROM assessment_score_entries
      WHERE school_id=$1 AND learner_id=$2 ORDER BY term_id,subject_id,kind,created_at DESC,id DESC`,[actor.schoolId,learnerId])).rows as { term_id: string; subject_id: string; kind: string; score: number }[];
    const terms = (await client.query(`SELECT t.id,t.name,t.start_date::text,t.academic_year_id,y.name AS year_name,y.start_date::text AS year_start FROM terms t
      JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 ORDER BY t.start_date`,[actor.schoolId])).rows as { id: string; name: string; start_date: string; academic_year_id: string; year_name: string; year_start: string }[];
    // Term result per (term, subject) when both CA and exam are recorded.
    const results = new Map<string, number>();
    if (policy) for (const s of scores) {
      if (s.kind !== 'ca') continue;
      const exam = scores.find(e => e.term_id === s.term_id && e.subject_id === s.subject_id && e.kind === 'exam');
      if (exam) results.set(`${s.term_id}:${s.subject_id}`, weightedTotal(s.score,exam.score,policy));
    }
    const termOf = new Map(terms.map(t => [t.id,t]));
    const subjectIds = [...new Set([...marks.map(m => m.subject_id),...[...results.keys()].map(k => k.split(':')[1]!)])];
    const subjects = (await client.query('SELECT id,name FROM subjects WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY name',[actor.schoolId,subjectIds])).rows as { id: string; name: string }[];

    type Bucket = { key: string; start: string; label: string };
    const markBucket = (m: typeof marks[number]): Bucket => {
      if (period === 'week') { const start = mondayOf(m.held_on); return {key:start,start,label:start}; }
      if (period === 'month') { const start = `${m.held_on.slice(0,7)}-01`; return {key:start,start,label:start}; }
      const t = termOf.get(m.term_id)!;
      return period === 'term' ? {key:t.id,start:t.start_date,label:`${t.name} ${t.year_name}`} : {key:t.academic_year_id,start:t.year_start,label:t.year_name};
    };
    const resultBucket = (termId: string): Bucket => { const t = termOf.get(termId)!; return period === 'term' ? {key:t.id,start:t.start_date,label:`${t.name} ${t.year_name}`} : {key:t.academic_year_id,start:t.year_start,label:t.year_name}; };
    const bucketMap = new Map<string, Bucket>();
    for (const m of marks) { const b = markBucket(m); bucketMap.set(b.key,b); }
    if (period === 'term' || period === 'year') for (const key of results.keys()) { const b = resultBucket(key.split(':')[0]!); bucketMap.set(b.key,b); }
    const buckets = [...bucketMap.values()].sort((a,b) => a.start.localeCompare(b.start));
    const series = subjects.map(s => ({subjectId:s.id,name:s.name,points:buckets.map(b => {
      const p = marks.filter(m => m.subject_id === s.id && markBucket(m).key === b.key).map(m => m.percent);
      const termResults = period === 'term' || period === 'year' ? [...results.entries()].filter(([k]) => k.endsWith(`:${s.id}`) && resultBucket(k.split(':')[0]!).key === b.key).map(([,v]) => v) : [];
      return {key:b.key,assessmentAverage:mean(p),marks:p.length,termResult:mean(termResults)};
    })}));
    const overall = buckets.map(b => ({key:b.key,assessmentAverage:mean(marks.filter(m => markBucket(m).key === b.key).map(m => m.percent))}));
    return {learner:{id:learner.id,fullName:learner.full_name,admissionNumber:learner.admission_number},period,buckets,overall,subjects:series};
  }
}

// Each CA part's average percentage over the given marks.
function partAverages(marks: Mark[]) {
  return Object.fromEntries(CA_PARTS.map(part => [part,mean(marks.filter(m => partOf(m.kind) === part).map(m => m.percent))])) as Record<CaPart, number | null>;
}

// ISO week start (Monday) of a YYYY-MM-DD date.
export function mondayOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`), back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0,10);
}
