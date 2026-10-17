import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { PolicyDto, PublishDto, RecordScoresDto, ReissueDto, ReopenDto, RemarksDto, SubjectDto, TermDto } from './assessment.dto';

// Each part's share of the CA out of 100 (the settings form shows them as points of the final score). Up to four decimals.
export type CaParts = { exercises: number; homework: number; tests: number; projects: number };
// Matches the column default in migration 041.
export const DEFAULT_CA_PARTS: CaParts = {exercises:30,homework:30,tests:40,projects:0};
type Policy = { ca_weight: number; exam_weight: number; ca_parts: CaParts; bands: { min: number; grade: string; remark: string }[]; source_note: string; version: number };
type Learner = { id: string; full_name: string; admission_number: string; left: boolean };
type Entry = { learner_id: string; subject_id: string; kind: string; score: number };

// Integer arithmetic in hundredths so weighted totals round half-up to one decimal without float drift.
export function weightedTotal(ca: number, exam: number, policy: Pick<Policy, 'ca_weight' | 'exam_weight'>) {
  const numerator = Math.round(ca * 100) * policy.ca_weight + Math.round(exam * 100) * policy.exam_weight;
  return Math.floor((numerator + 500) / 1000) / 10;
}
export function gradeFor(total: number, bands: Policy['bands']) {
  const ordered = [...bands].sort((a, b) => b.min - a.min);
  return ordered.find(band => total >= band.min) ?? ordered[ordered.length - 1];
}

@Injectable()
export class AssessmentService {
  async policy(client: PoolClient, schoolId: string) {
    return (await client.query('SELECT ca_weight,exam_weight,ca_parts,bands,source_note,version FROM assessment_policies WHERE school_id=$1',[schoolId])).rows[0] as Policy | undefined;
  }
  async setPolicy(client: PoolClient, actor: Actor, body: PolicyDto) {
    if (body.caWeight + body.examWeight !== 100) throw new BadRequestException('Continuous assessment and exam weights must add up to 100');
    const mins = body.bands.map(band => band.min);
    if (new Set(mins).size !== mins.length || !mins.includes(0)) throw new BadRequestException('Grade bands need distinct minimum scores and one starting at 0');
    if (body.caParts && Math.round((body.caParts.exercises + body.caParts.homework + body.caParts.tests + body.caParts.projects) * 10000) !== 1000000) throw new BadRequestException('The parts of continuous assessment must add up to 100');
    return command(client,actor,body.operationId,'assessment.policy',body,async () => {
      const current = await this.policy(client,actor.schoolId);
      if (current && body.version !== current.version) throw new ConflictException('The assessment policy changed. Reload before saving');
      // Parts left out keep what the school had (or the default on a first save).
      const parts = body.caParts ? {exercises:body.caParts.exercises,homework:body.caParts.homework,tests:body.caParts.tests,projects:body.caParts.projects} : null;
      const values = [actor.schoolId,body.caWeight,body.examWeight,JSON.stringify(body.bands),body.sourceNote.trim(),actor.membershipId,parts && JSON.stringify(parts)];
      const row = current
        ? (await client.query('UPDATE assessment_policies SET ca_weight=$2,exam_weight=$3,bands=$4,source_note=$5,updated_by=$6,updated_at=now(),version=version+1,ca_parts=coalesce($7::jsonb,ca_parts) WHERE school_id=$1 RETURNING ca_weight,exam_weight,ca_parts,bands,source_note,version',values)).rows[0]
        : (await client.query('INSERT INTO assessment_policies(school_id,ca_weight,exam_weight,bands,source_note,updated_by,ca_parts) VALUES($1,$2,$3,$4,$5,$6,coalesce($7::jsonb,$8::jsonb)) RETURNING ca_weight,exam_weight,ca_parts,bands,source_note,version',[...values,JSON.stringify(DEFAULT_CA_PARTS)])).rows[0];
      await audit(client,actor,'assessment.policy.saved',actor.schoolId,{version:row.version});
      return row;
    });
  }
  createSubject(client: PoolClient, actor: Actor, body: SubjectDto) {
    return command(client,actor,body.operationId,'assessment.subject',body,async () => {
      const row = (await client.query('INSERT INTO subjects(id,school_id,name) VALUES($1,$2,$3) RETURNING id,name',[randomUUID(),actor.schoolId,body.name.trim()])).rows[0];
      await audit(client,actor,'assessment.subject.created',row.id);
      return row;
    });
  }
  createTerm(client: PoolClient, actor: Actor, body: TermDto) {
    return command(client,actor,body.operationId,'assessment.term',body,async () => {
      const year = (await client.query('SELECT start_date::text,end_date::text FROM academic_years WHERE school_id=$1 AND id=$2',[actor.schoolId,body.academicYearId])).rows[0];
      if (!year) throw new NotFoundException('Academic year unavailable');
      if (body.startDate < year.start_date || body.endDate > year.end_date) throw new BadRequestException('A term must sit inside its academic year');
      const row = (await client.query('INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,academic_year_id,name,start_date::text,end_date::text',[randomUUID(),actor.schoolId,body.academicYearId,body.name.trim(),body.startDate,body.endDate])).rows[0];
      await audit(client,actor,'assessment.term.created',row.id);
      return row;
    });
  }
  async term(client: PoolClient, schoolId: string, termId: string) {
    const term = (await client.query('SELECT id,name,start_date::text,end_date::text FROM terms WHERE school_id=$1 AND id=$2',[schoolId,termId])).rows[0];
    if (!term) throw new NotFoundException('Term unavailable');
    return term;
  }
  // Heads may work on any class; teachers only on a class they are live-assigned to today.
  async classFor(client: PoolClient, actor: Actor, classId: string) {
    const section = (await client.query('SELECT c.id,c.name,c.level FROM class_sections c WHERE c.school_id=$1 AND c.id=$2',[actor.schoolId,classId])).rows[0];
    if (!section) throw new NotFoundException('Class unavailable');
    if (actor.role === 'teacher') {
      const live = await client.query("SELECT 1 FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND teacher_membership_id=$3 AND revoked_at IS NULL AND start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND end_date>(now() AT TIME ZONE 'Africa/Accra')::date",[actor.schoolId,classId,actor.membershipId]);
      if (!live.rowCount) throw new NotFoundException('Class unavailable');
    } else if (actor.role !== 'headteacher') throw new ForbiddenException('Your role cannot perform this action');
    return section;
  }
  async learners(client: PoolClient, schoolId: string, classId: string, term: { start_date: string; end_date: string }) {
    // left: every enrolment in this class ended before the term's last day (withdrawn or moved during the term).
    return (await client.query(`SELECT l.id,l.full_name,l.admission_number,bool_and(e.end_date IS NOT NULL AND e.end_date<=$4) AS left FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id
      WHERE e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<$4 AND (e.end_date IS NULL OR e.end_date>$3) GROUP BY l.id ORDER BY l.full_name,l.id`,[schoolId,classId,term.start_date,term.end_date])).rows as Learner[];
  }
  private async latest(client: PoolClient, schoolId: string, termId: string, classId: string) {
    return (await client.query('SELECT DISTINCT ON (learner_id,subject_id,kind) learner_id,subject_id,kind,score::float AS score FROM assessment_score_entries WHERE school_id=$1 AND term_id=$2 AND class_id=$3 ORDER BY learner_id,subject_id,kind,created_at DESC,id DESC',[schoolId,termId,classId])).rows as Entry[];
  }
  // Locked = has a published report and no newer reopening.
  private async lockedLearners(client: PoolClient, schoolId: string, termId: string, classId: string) {
    return new Set((await client.query(`SELECT r.learner_id FROM terminal_reports r WHERE r.school_id=$1 AND r.term_id=$2 AND r.class_id=$3 GROUP BY r.school_id,r.term_id,r.learner_id
      HAVING NOT EXISTS (SELECT 1 FROM assessment_reopenings o WHERE o.school_id=r.school_id AND o.term_id=r.term_id AND o.learner_id=r.learner_id AND o.opened_at>max(r.published_at))`,[schoolId,termId,classId])).rows.map(row => row.learner_id as string));
  }
  async grid(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId?: string) {
    const section = await this.classFor(client,actor,classId), term = await this.term(client,actor.schoolId,termId);
    const learners = await this.learners(client,actor.schoolId,classId,term);
    const entries = (await this.latest(client,actor.schoolId,termId,classId)).filter(entry => !subjectId || entry.subject_id === subjectId);
    const published = await this.lockedLearners(client,actor.schoolId,termId,classId);
    const everPublished = new Set((await client.query('SELECT DISTINCT learner_id FROM terminal_reports WHERE school_id=$1 AND term_id=$2 AND class_id=$3',[actor.schoolId,termId,classId])).rows.map(row => row.learner_id as string));
    return {class:section,term,policy:(await this.policy(client,actor.schoolId)) ?? null,items:learners.map(learner => ({
      learnerId:learner.id,fullName:learner.full_name,admissionNumber:learner.admission_number,left:learner.left,locked:published.has(learner.id),published:everPublished.has(learner.id),
      ca:entries.find(e => e.learner_id === learner.id && e.kind === 'ca')?.score ?? null,exam:entries.find(e => e.learner_id === learner.id && e.kind === 'exam')?.score ?? null,
    }))};
  }
  record(client: PoolClient, actor: Actor, classId: string, body: RecordScoresDto) {
    return command(client,actor,body.operationId,'assessment.scores',{classId,...body},async () => {
      await this.classFor(client,actor,classId);
      if (!(await this.policy(client,actor.schoolId))) throw new ConflictException('Set the school assessment policy before recording scores');
      const term = await this.term(client,actor.schoolId,body.termId);
      if (!(await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2',[actor.schoolId,body.subjectId])).rowCount) throw new NotFoundException('Subject unavailable');
      const eligible = new Set((await this.learners(client,actor.schoolId,classId,term)).map(learner => learner.id));
      const keys = body.scores.map(score => `${score.learnerId}:${score.kind}`);
      if (new Set(keys).size !== keys.length) throw new BadRequestException('Each learner and score type may appear once');
      if (body.scores.some(score => !eligible.has(score.learnerId))) throw new NotFoundException('A learner is not in this class for the term');
      const current = new Map((await this.latest(client,actor.schoolId,body.termId,classId)).filter(entry => entry.subject_id === body.subjectId).map(entry => [`${entry.learner_id}:${entry.kind}`,entry.score]));
      let written = 0;
      for (const score of body.scores) {
        if (current.get(`${score.learnerId}:${score.kind}`) === score.score) continue;
        await client.query('INSERT INTO assessment_score_entries(id,school_id,term_id,class_id,subject_id,learner_id,kind,score,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),actor.schoolId,body.termId,classId,body.subjectId,score.learnerId,score.kind,score.score,actor.membershipId]);
        written++;
      }
      await audit(client,actor,'assessment.scores.recorded',classId,{termId:body.termId,subjectId:body.subjectId,written});
      return {written,unchanged:body.scores.length - written};
    }).catch(error => { if ((error as {code?:string}).code === '23514') throw new ConflictException((error as Error).message); throw error; });
  }
  // Deterministic results: the only place totals, grades and positions are computed.
  async results(client: PoolClient, actor: Actor, classId: string, termId: string) {
    const section = await this.classFor(client,actor,classId), term = await this.term(client,actor.schoolId,termId);
    const policy = await this.policy(client,actor.schoolId);
    if (!policy) throw new ConflictException('Set the school assessment policy first');
    const learners = await this.learners(client,actor.schoolId,classId,term), entries = await this.latest(client,actor.schoolId,termId,classId);
    const subjectIds = [...new Set(entries.map(entry => entry.subject_id))];
    const names = new Map((await client.query('SELECT id,name FROM subjects WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY name',[actor.schoolId,subjectIds])).rows.map(row => [row.id,row.name as string]));
    const ordered = [...names.keys()];
    const rows = learners.map(learner => {
      const subjects = ordered.map(subjectId => {
        const ca = entries.find(e => e.learner_id === learner.id && e.subject_id === subjectId && e.kind === 'ca')?.score, exam = entries.find(e => e.learner_id === learner.id && e.subject_id === subjectId && e.kind === 'exam')?.score;
        const total = ca === undefined || exam === undefined ? null : weightedTotal(ca,exam,policy);
        const band = total === null ? null : gradeFor(total,policy.bands);
        return {subjectId,name:names.get(subjectId)!,ca:ca ?? null,exam:exam ?? null,total,grade:band?.grade ?? null,remark:band?.remark ?? null};
      });
      const complete = subjects.length > 0 && subjects.every(subject => subject.total !== null);
      const average = complete ? Math.round(subjects.reduce((sum,subject) => sum + subject.total!*10,0) / subjects.length) / 10 : null;
      return {learnerId:learner.id,fullName:learner.full_name,admissionNumber:learner.admission_number,left:learner.left,subjects,complete,average,position:null as number | null};
    });
    const ranked = rows.filter(row => row.complete).sort((a,b) => b.average! - a.average!);
    ranked.forEach((row,index) => { row.position = index > 0 && row.average === ranked[index - 1].average ? ranked[index - 1].position : index + 1; });
    // Class size on the report is the class at the end of term; learners who left are listed but not counted.
    return {class:section,term,policy:{caWeight:policy.ca_weight,examWeight:policy.exam_weight,bands:policy.bands,sourceNote:policy.source_note},classSize:rows.filter(row => !row.left).length,items:rows};
  }
  private async latestRemarks(client: PoolClient, schoolId: string, termId: string, classId: string) {
    return (await client.query(`SELECT DISTINCT ON (learner_id,author) learner_id,author,conduct,attitude,interest,remark,created_at FROM terminal_report_remarks
      WHERE school_id=$1 AND term_id=$2 AND class_id=$3 ORDER BY learner_id,author,created_at DESC,id DESC`,[schoolId,termId,classId])).rows as { learner_id: string; author: string; conduct: string | null; attitude: string | null; interest: string | null; remark: string | null }[];
  }
  async remarks(client: PoolClient, actor: Actor, classId: string, termId: string) {
    await this.classFor(client,actor,classId);
    const term = await this.term(client,actor.schoolId,termId);
    const learners = await this.learners(client,actor.schoolId,classId,term), rows = await this.latestRemarks(client,actor.schoolId,termId,classId);
    const locked = await this.lockedLearners(client,actor.schoolId,termId,classId);
    return {items:learners.map(learner => {
      const teacher = rows.find(row => row.learner_id === learner.id && row.author === 'class_teacher'), head = rows.find(row => row.learner_id === learner.id && row.author === 'headteacher');
      return {learnerId:learner.id,fullName:learner.full_name,locked:locked.has(learner.id),conduct:teacher?.conduct ?? null,attitude:teacher?.attitude ?? null,interest:teacher?.interest ?? null,teacherRemark:teacher?.remark ?? null,headRemark:head?.remark ?? null};
    })};
  }
  recordRemarks(client: PoolClient, actor: Actor, classId: string, body: RemarksDto) {
    return command(client,actor,body.operationId,'assessment.remarks',{classId,...body},async () => {
      await this.classFor(client,actor,classId);
      if (body.author === 'headteacher' && actor.role !== 'headteacher') throw new ForbiddenException('Only the headteacher writes the headteacher\'s remark');
      const term = await this.term(client,actor.schoolId,body.termId);
      const eligible = new Set((await this.learners(client,actor.schoolId,classId,term)).map(learner => learner.id));
      if (new Set(body.items.map(item => item.learnerId)).size !== body.items.length) throw new BadRequestException('Each learner may appear once');
      if (body.items.some(item => !eligible.has(item.learnerId))) throw new NotFoundException('A learner is not in this class for the term');
      const current = new Map((await this.latestRemarks(client,actor.schoolId,body.termId,classId)).filter(row => row.author === body.author).map(row => [row.learner_id,row]));
      let written = 0;
      for (const item of body.items) {
        const values = body.author === 'headteacher' ? {conduct:null,attitude:null,interest:null,remark:item.remark?.trim() ?? null}
          : {conduct:item.conduct?.trim() ?? null,attitude:item.attitude?.trim() ?? null,interest:item.interest?.trim() ?? null,remark:item.remark?.trim() ?? null};
        const before = current.get(item.learnerId);
        if (before && before.conduct === values.conduct && before.attitude === values.attitude && before.interest === values.interest && before.remark === values.remark) continue;
        if (!before && Object.values(values).every(value => value === null)) continue;
        await client.query('INSERT INTO terminal_report_remarks(id,school_id,term_id,class_id,learner_id,author,conduct,attitude,interest,remark,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [randomUUID(),actor.schoolId,body.termId,classId,item.learnerId,body.author,values.conduct,values.attitude,values.interest,values.remark,actor.membershipId]);
        written++;
      }
      await audit(client,actor,'assessment.remarks.recorded',classId,{termId:body.termId,author:body.author,written});
      return {written,unchanged:body.items.length - written};
    }).catch(error => { if ((error as {code?:string}).code === '23514') throw new ConflictException('This report is published. Reopen it for correction before changing remarks'); throw error; });
  }
  // Everything printed on a Ghanaian terminal report besides the scores, fixed into the snapshot at publication.
  private async reportExtras(client: PoolClient, schoolId: string, classId: string, term: { id: string; start_date: string; end_date: string }) {
    const school = (await client.query('SELECT name,address,phone,motto FROM schools WHERE id=$1',[schoolId])).rows[0];
    const yearName = (await client.query('SELECT y.name FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 AND t.id=$2',[schoolId,term.id])).rows[0]?.name ?? null;
    const nextTerm = (await client.query('SELECT name,start_date::text FROM terms WHERE school_id=$1 AND start_date>$2 ORDER BY start_date LIMIT 1',[schoolId,term.end_date])).rows[0] ?? null;
    const attendance = new Map((await client.query(`SELECT m.learner_id,count(*) FILTER (WHERE m.mark IN ('present','late'))::int AS present,count(*) FILTER (WHERE m.mark<>'unmarked')::int AS marked
      FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id
      WHERE r.school_id=$1 AND r.class_id=$2 AND r.day>=$3 AND r.day<=$4 AND r.status IN ('submitted','locked') GROUP BY m.learner_id`,[schoolId,classId,term.start_date,term.end_date])).rows.map(row => [row.learner_id as string,{present:row.present as number,possible:row.marked as number}]));
    const remarks = await this.latestRemarks(client,schoolId,term.id,classId);
    return {school,yearName,nextTerm,attendance,remarks};
  }
  private snapshotOf(results: any, row: any, extras: Awaited<ReturnType<AssessmentService['reportExtras']>>) {
    const teacher = extras.remarks.find(r => r.learner_id === row.learnerId && r.author === 'class_teacher'), head = extras.remarks.find(r => r.learner_id === row.learnerId && r.author === 'headteacher');
    return {term:results.term,class:results.class,classSize:results.classSize,policy:results.policy,learner:{id:row.learnerId,fullName:row.fullName,admissionNumber:row.admissionNumber},subjects:row.subjects,average:row.average,position:row.position,complete:row.complete,
      school:extras.school,yearName:extras.yearName,nextTermBegins:extras.nextTerm?.start_date ?? null,attendance:extras.attendance.get(row.learnerId) ?? {present:0,possible:0},
      conduct:teacher?.conduct ?? null,attitude:teacher?.attitude ?? null,interest:teacher?.interest ?? null,teacherRemark:teacher?.remark ?? null,headRemark:head?.remark ?? null};
  }
  reopen(client: PoolClient, actor: Actor, classId: string, body: ReopenDto) {
    return command(client,actor,body.operationId,'assessment.reopen',{classId,...body},async () => {
      await this.classFor(client,actor,classId);
      const latest = (await client.query('SELECT max(published_at) AS at FROM terminal_reports WHERE school_id=$1 AND term_id=$2 AND class_id=$3 AND learner_id=$4',[actor.schoolId,body.termId,classId,body.learnerId])).rows[0];
      if (!latest.at) throw new ConflictException('There is no published report to correct for this learner');
      if ((await client.query('SELECT 1 FROM assessment_reopenings WHERE school_id=$1 AND term_id=$2 AND learner_id=$3 AND opened_at>$4',[actor.schoolId,body.termId,body.learnerId,latest.at])).rowCount) throw new ConflictException('This report is already open for correction');
      const id = randomUUID();
      await client.query('INSERT INTO assessment_reopenings(id,school_id,term_id,learner_id,reason,opened_by) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.schoolId,body.termId,body.learnerId,body.reason.trim(),actor.membershipId]);
      await audit(client,actor,'assessment.report.reopened',body.learnerId,{termId:body.termId,reason:body.reason.trim()});
      return {reopened:true};
    });
  }
  reissue(client: PoolClient, actor: Actor, classId: string, body: ReissueDto) {
    return command(client,actor,body.operationId,'assessment.reissue',{classId,...body},async () => {
      const reopening = (await client.query(`SELECT o.reason FROM assessment_reopenings o WHERE o.school_id=$1 AND o.term_id=$2 AND o.learner_id=$3
        AND o.opened_at>(SELECT max(r.published_at) FROM terminal_reports r WHERE r.school_id=o.school_id AND r.term_id=o.term_id AND r.learner_id=o.learner_id) ORDER BY o.opened_at DESC LIMIT 1`,[actor.schoolId,body.termId,body.learnerId])).rows[0];
      if (!reopening) throw new ConflictException('Reopen this report for correction before publishing a new revision');
      const results = await this.results(client,actor,classId,body.termId);
      const row = results.items.find(item => item.learnerId === body.learnerId);
      if (!row) throw new NotFoundException('Learner is not in this class for the term');
      if (!row.complete && !body.acknowledgeIncomplete) throw new ConflictException('This learner still has missing scores. Complete them or acknowledge publishing an incomplete report');
      const previous = (await client.query('SELECT id,revision FROM terminal_reports WHERE school_id=$1 AND term_id=$2 AND learner_id=$3 ORDER BY revision DESC LIMIT 1',[actor.schoolId,body.termId,body.learnerId])).rows[0];
      const id = randomUUID(), extras = await this.reportExtras(client,actor.schoolId,classId,{...results.term,id:body.termId});
      await client.query('INSERT INTO terminal_reports(id,school_id,term_id,class_id,learner_id,snapshot,published_by,revision,supersedes_id,correction_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,actor.schoolId,body.termId,classId,body.learnerId,JSON.stringify(this.snapshotOf(results,row,extras)),actor.membershipId,previous.revision + 1,previous.id,reopening.reason]);
      await audit(client,actor,'assessment.report.reissued',body.learnerId,{termId:body.termId,revision:previous.revision + 1});
      return {revision:previous.revision + 1};
    });
  }
  publish(client: PoolClient, actor: Actor, classId: string, body: PublishDto) {
    return command(client,actor,body.operationId,'assessment.publish',{classId,...body},async () => {
      const results = await this.results(client,actor,classId,body.termId);
      if (!results.items.length || !results.items.some(row => row.subjects.length)) throw new ConflictException('There are no scores to publish for this class and term');
      // A learner who left during the term with no scores gets no report and does not hold up the class.
      const leftWithoutScores = (row: typeof results.items[number]) => row.left && row.subjects.every(subject => subject.ca === null && subject.exam === null);
      const incomplete = results.items.filter(row => !row.complete && !leftWithoutScores(row)).length;
      if (incomplete && !body.acknowledgeIncomplete) throw new ConflictException(`${incomplete} learner(s) have missing scores. Complete them or acknowledge publishing incomplete reports`);
      const already = new Set((await client.query('SELECT learner_id FROM terminal_reports WHERE school_id=$1 AND term_id=$2 AND class_id=$3',[actor.schoolId,body.termId,classId])).rows.map(row => row.learner_id));
      let published = 0;
      const extras = await this.reportExtras(client,actor.schoolId,classId,{...results.term,id:body.termId});
      for (const row of results.items) {
        if (already.has(row.learnerId) || leftWithoutScores(row)) continue;
        const snapshot = this.snapshotOf(results,row,extras);
        await client.query('INSERT INTO terminal_reports(id,school_id,term_id,class_id,learner_id,snapshot,published_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),actor.schoolId,body.termId,classId,row.learnerId,JSON.stringify(snapshot),actor.membershipId]);
        published++;
      }
      await audit(client,actor,'assessment.reports.published',classId,{termId:body.termId,published,incomplete});
      return {published,alreadyPublished:already.size,incomplete};
    });
  }
  // Latest published revision of each learner's report in a class, for printing at vacation.
  async classReports(client: PoolClient, actor: Actor, classId: string, termId: string) {
    await this.classFor(client,actor,classId);
    return {items:(await client.query(`SELECT DISTINCT ON (r.learner_id) r.id,r.learner_id,r.snapshot,r.published_at,r.revision FROM terminal_reports r
      WHERE r.school_id=$1 AND r.term_id=$2 AND r.class_id=$3 ORDER BY r.learner_id,r.revision DESC`,[actor.schoolId,termId,classId])).rows
      .sort((a,b) => String(a.snapshot.learner.fullName).localeCompare(String(b.snapshot.learner.fullName)))};
  }
  // Latest revision of every published report in the term, class by class, for printing one card per page.
  async schoolReports(client: PoolClient, actor: Actor, termId: string, level?: string) {
    await this.term(client,actor.schoolId,termId);
    return {items:(await client.query(`SELECT r.id,r.learner_id,r.snapshot,r.published_at,r.revision,c.name AS class_name,c.level FROM (
        SELECT DISTINCT ON (learner_id) * FROM terminal_reports WHERE school_id=$1 AND term_id=$2 ORDER BY learner_id,revision DESC) r
      JOIN class_sections c ON c.school_id=r.school_id AND c.id=r.class_id
      WHERE $3::text IS NULL OR c.level=$3 ORDER BY c.name,c.id,r.snapshot->'learner'->>'fullName',r.learner_id`,[actor.schoolId,termId,level ?? null])).rows};
  }
  async guardianReports(client: PoolClient, actor: Actor, learnerId: string) {
    const link = (await client.query('SELECT id FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rows[0];
    if (!link) throw new NotFoundException('Child unavailable');
    return {items:(await client.query('SELECT DISTINCT ON (term_id) id,term_id,snapshot,published_at,revision,correction_reason FROM terminal_reports WHERE school_id=$1 AND learner_id=$2 ORDER BY term_id,revision DESC',[actor.schoolId,learnerId])).rows};
  }
}
