import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { ClassAssessmentDto, RecordMarksDto } from './assessment.dto';
import { AssessmentService, weightedTotal } from './assessment.service';

type Mark = { assessment_id: string; learner_id: string; subject_id: string; held_on: string; percent: number };
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

@Injectable()
export class ProgressService {
  constructor(private readonly assessment: AssessmentService) {}

  // Latest mark per learner for each assessment, as a percentage of its maximum.
  private async marks(client: PoolClient, schoolId: string, where: string, params: unknown[]) {
    return (await client.query(`SELECT a.id AS assessment_id,m.learner_id,a.subject_id,a.held_on::text,round(m.mark*100/a.max_mark,1)::float AS percent
      FROM class_assessments a JOIN LATERAL (SELECT DISTINCT ON (x.learner_id) x.learner_id,x.mark FROM class_assessment_marks x
        WHERE x.school_id=a.school_id AND x.assessment_id=a.id ORDER BY x.learner_id,x.created_at DESC,x.id DESC) m ON true
      WHERE a.school_id=$1 AND ${where} ORDER BY a.held_on,a.created_at,a.id`,[schoolId,...params])).rows as Mark[];
  }

  create(client: PoolClient, actor: Actor, classId: string, body: ClassAssessmentDto) {
    return command(client,actor,body.operationId,'assessment.class_assessment',{classId,...body},async () => {
      await this.assessment.classFor(client,actor,classId);
      const term = await this.assessment.term(client,actor.schoolId,body.termId);
      if (body.heldOn < term.start_date || body.heldOn > term.end_date) throw new BadRequestException('The assessment date must fall inside the term');
      if (!(await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2',[actor.schoolId,body.subjectId])).rowCount) throw new NotFoundException('Subject unavailable');
      const row = (await client.query(`INSERT INTO class_assessments(id,school_id,term_id,class_id,subject_id,kind,title,held_on,max_mark,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id,kind,title,held_on::text,max_mark::float`,[randomUUID(),actor.schoolId,body.termId,classId,body.subjectId,body.kind,body.title.trim(),body.heldOn,body.maxMark,actor.membershipId])).rows[0];
      await audit(client,actor,'assessment.class_assessment.created',row.id,{classId,termId:body.termId,subjectId:body.subjectId});
      return row;
    });
  }

  async list(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId?: string) {
    await this.assessment.classFor(client,actor,classId);
    const marks = await this.marks(client,actor.schoolId,'a.class_id=$2 AND a.term_id=$3',[classId,termId]);
    const rows = (await client.query(`SELECT a.id,a.subject_id,s.name AS subject_name,a.kind,a.title,a.held_on::text,a.max_mark::float FROM class_assessments a JOIN subjects s ON s.school_id=a.school_id AND s.id=a.subject_id
      WHERE a.school_id=$1 AND a.class_id=$2 AND a.term_id=$3 AND ($4::uuid IS NULL OR a.subject_id=$4) ORDER BY a.held_on DESC,a.created_at DESC,a.id`,[actor.schoolId,classId,termId,subjectId ?? null])).rows;
    return {items:rows.map(row => { const own = marks.filter(m => m.assessment_id === row.id).map(m => m.percent); return {...row,marked:own.length,average:mean(own)}; })};
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

  // Suggested continuous assessment score: the average percentage of the term's assessments in the subject,
  // each assessment counting equally. The teacher reviews it and saves it as the CA score themselves.
  async caSuggestion(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId: string) {
    await this.assessment.classFor(client,actor,classId);
    const marks = await this.marks(client,actor.schoolId,'a.class_id=$2 AND a.term_id=$3 AND a.subject_id=$4',[classId,termId,subjectId]);
    const learners = [...new Set(marks.map(m => m.learner_id))];
    return {items:learners.map(learnerId => { const own = marks.filter(m => m.learner_id === learnerId).map(m => m.percent); return {learnerId,ca:mean(own),assessments:own.length}; })};
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
    const overall = buckets.map(start => ({start,average:mean(marks.filter(m => bucketOf(m.held_on) === start).map(m => m.percent))}));
    const attention = learners.filter(l => !l.left).flatMap(l => subjects.flatMap(s => {
      const flag = attentionFor(marks.filter(m => m.learner_id === l.id && m.subject_id === s.id).map(m => m.percent));
      return flag ? [{learnerId:l.id,fullName:l.full_name,subjectId:s.id,subject:s.name,...flag}] : [];
    }));
    return {class:section,term,period,buckets,overall,subjects:series,attention};
  }

  // Heads see any learner; teachers see learners enrolled today in a class they are live-assigned to.
  private async learnerFor(client: PoolClient, actor: Actor, learnerId: string) {
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
      WHERE a.school_id=$1 ORDER BY a.held_on,a.created_at,a.id`,[actor.schoolId,learnerId])).rows as { subject_id: string; held_on: string; term_id: string; academic_year_id: string; percent: number }[];
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

// ISO week start (Monday) of a YYYY-MM-DD date.
export function mondayOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`), back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0,10);
}
