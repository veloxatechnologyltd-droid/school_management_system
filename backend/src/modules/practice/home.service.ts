import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { AssessmentService } from '../assessment/assessment.service';
import { ProgressService, mondayOf } from '../assessment/progress.service';
import { stageOf } from '../content/checks';
import { AI_LABEL } from '../learning/topics.service';
import { gradeMatches } from '../learning/scope';
import { historyEntry, historyList } from './history';
import { AnswerDto, HomePracticeSettingsDto, StartSessionDto, StartStudyDto } from './practice.dto';
import { LEVEL_COUNT } from './questions';
import { SESSIONS_PER_TOPIC_PER_DAY, SESSION_SIZE, TOPICS_OFFERED, afterSession, parseNumber, sameNumber } from './rules';

const accraToday = (client: PoolClient) => client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS d").then(r => r.rows[0].d as string);
const STUDIES_PER_TOPIC_PER_DAY = 3;
type Pick = { indicatorId: string; subject: string; topic: string; setId: string; lessonId: string | null };
type Learned = { indicatorId: string; subject: string; topic: string; level: number; done: boolean; sessionsThisWeek: number; sessionsToday: number; lastPracticedOn: string | null; openSessionId: string | null; answeredInOpen: number };

// Home practice for families: the school's switch, what a verified guardian's child is offered, and the sessions themselves.
// Families never see percentages, ranks or other children; staff read the same records as evidence beside class work.
@Injectable()
export class HomePracticeService {
  constructor(private readonly progress: ProgressService, private readonly assessment: AssessmentService) {}

  async settings(client: PoolClient, schoolId: string) {
    const row = (await client.query('SELECT enabled,version,updated_at FROM home_practice_settings WHERE school_id=$1',[schoolId])).rows[0];
    return row ? {enabled:row.enabled as boolean,version:row.version as number,updatedAt:row.updated_at} : {enabled:false,version:null,updatedAt:null};
  }
  setSettings(client: PoolClient, actor: Actor, body: HomePracticeSettingsDto) {
    return command(client,actor,body.operationId,'practice.home_settings',body,async () => {
      const current = await this.settings(client,actor.schoolId);
      if (current.version !== null && body.version !== current.version) throw new ConflictException('This setting changed. Reload before saving');
      const row = current.version === null
        ? (await client.query('INSERT INTO home_practice_settings(school_id,enabled,updated_by) VALUES($1,$2,$3) RETURNING enabled,version',[actor.schoolId,body.enabled,actor.membershipId])).rows[0]
        : (await client.query('UPDATE home_practice_settings SET enabled=$2,updated_by=$3,updated_at=now(),version=version+1 WHERE school_id=$1 RETURNING enabled,version',[actor.schoolId,body.enabled,actor.membershipId])).rows[0];
      await audit(client,actor,'practice.home_settings.saved',actor.schoolId,{enabled:row.enabled,version:row.version});
      return {enabled:row.enabled,version:row.version};
    });
  }

  // The caller must be a verified guardian with the academic right for this child. Locks the link so a revocation cannot slip in mid-answer.
  private async guardianOf(client: PoolClient, actor: Actor, learnerId: string) {
    const link = (await client.query('SELECT 1 FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rowCount;
    if (!link) throw new NotFoundException('Child unavailable');
  }

  // What the child has done on each topic, from the stored sessions.
  private async learned(client: PoolClient, schoolId: string, learnerId: string, today: string): Promise<Learned[]> {
    const rows = (await client.query(`SELECT i.id AS indicator_id,s.name AS subject,i.description AS topic,
        (SELECT x.outcome FROM practice_sessions x WHERE x.school_id=i.school_id AND x.learner_id=$2 AND x.indicator_id=i.id AND x.completed_at IS NOT NULL ORDER BY x.completed_at DESC,x.id DESC LIMIT 1) AS last_outcome,
        (SELECT x.level_after FROM practice_sessions x WHERE x.school_id=i.school_id AND x.learner_id=$2 AND x.indicator_id=i.id AND x.completed_at IS NOT NULL ORDER BY x.completed_at DESC,x.id DESC LIMIT 1) AS level_after,
        count(p.id) FILTER (WHERE p.completed_at IS NOT NULL AND (p.completed_at AT TIME ZONE 'Africa/Accra')::date>=$3::date)::int AS this_week,
        count(p.id) FILTER (WHERE (p.started_at AT TIME ZONE 'Africa/Accra')::date=$4::date)::int AS today,
        max(p.completed_at) FILTER (WHERE p.completed_at IS NOT NULL) AS last_at,
        (array_agg(p.id) FILTER (WHERE p.completed_at IS NULL))[1] AS open_id
      FROM practice_sessions p JOIN curriculum_indicators i ON i.school_id=p.school_id AND i.id=p.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE p.school_id=$1 AND p.learner_id=$2 GROUP BY i.id,i.school_id,s.name,i.description`,[schoolId,learnerId,mondayOf(today),today])).rows;
    const answered = new Map((await client.query(`SELECT i.session_id,count(*) FILTER (WHERE i.answered_at IS NOT NULL)::int AS n FROM practice_session_items i
      WHERE i.school_id=$1 AND i.session_id=ANY($2::uuid[]) GROUP BY i.session_id`,[schoolId,rows.flatMap(r => r.open_id ? [r.open_id] : [])])).rows.map(r => [r.session_id as string,r.n as number]));
    return rows.map(r => ({indicatorId:r.indicator_id,subject:r.subject,topic:r.topic,done:r.last_outcome === 'done',level:r.level_after ?? 1,sessionsThisWeek:r.this_week,sessionsToday:r.today,
      lastPracticedOn:r.last_at ? new Date(r.last_at).toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}) : null,openSessionId:r.open_id ?? null,answeredInOpen:r.open_id ? answered.get(r.open_id) ?? 0 : 0}));
  }

  // The topics where this term's tagged class work puts the child below 50%, weakest first.
  private async weakTopics(client: PoolClient, schoolId: string, learnerId: string, today: string) {
    const terms = await this.termsCovering(client,schoolId,today);
    if (!terms.length) return [] as { indicatorId: string; subject: string; topic: string }[];
    return (await client.query(`WITH latest AS (
        SELECT a.id AS assessment_id,round(m.mark*100/a.max_mark,1) AS percent FROM class_assessments a
        JOIN LATERAL (SELECT x.mark FROM class_assessment_marks x WHERE x.school_id=a.school_id AND x.assessment_id=a.id AND x.learner_id=$2 ORDER BY x.created_at DESC,x.id DESC LIMIT 1) m ON true
        WHERE a.school_id=$1 AND a.term_id=ANY($3::uuid[]) AND a.kind<>'mock')
      SELECT i.id AS indicator_id,s.name AS subject,i.description AS topic FROM latest l
      JOIN class_assessment_indicators x ON x.school_id=$1 AND x.assessment_id=l.assessment_id JOIN curriculum_indicators i ON i.school_id=x.school_id AND i.id=x.indicator_id AND i.retired_at IS NULL
      JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      GROUP BY i.id,s.name,i.description HAVING avg(l.percent)<50 ORDER BY avg(l.percent),i.description`,[schoolId,learnerId,terms])).rows
      .map(r => ({indicatorId:r.indicator_id as string,subject:r.subject as string,topic:r.topic as string}));
  }
  private async termsCovering(client: PoolClient, schoolId: string, today: string) {
    return (await client.query('SELECT id FROM terms WHERE school_id=$1 AND start_date<=$2 AND end_date>=$2',[schoolId,today])).rows.map(r => r.id as string);
  }

  // What a child could practise now, and which set each topic would use. A topic needs a set with at least a session's worth of live questions at the
  // child's level: the teacher's own set while it has them, otherwise the questions Claude made for the topic, which only count when the topic is
  // approved this term for the child's class. `approved` is every topic approved for the child's class; `weak` is the topics class work shows are hard.
  private async available(client: PoolClient, schoolId: string, learnerId: string, today: string, className: string, levelOf: (indicatorId: string) => number) {
    const weakRows = await this.weakTopics(client,schoolId,learnerId,today);
    const terms = await this.termsCovering(client,schoolId,today);
    // A topic can be approved for several class levels, so the child's class is matched before topics are counted once each.
    const approvedRows = terms.length ? [...new Map((await client.query(`SELECT i.id AS indicator_id,a.grade,s.name AS subject,i.description AS topic FROM topic_approvals a
      JOIN curriculum_indicators i ON i.school_id=a.school_id AND i.id=a.indicator_id AND i.retired_at IS NULL JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE a.school_id=$1 AND a.retired_at IS NULL AND a.term_id=ANY($2::uuid[]) ORDER BY i.id,a.approved_at`,[schoolId,terms])).rows.filter(r => gradeMatches(className,r.grade as string)).map(r => [r.indicator_id as string,r])).values()] : [];
    const approvedIds = new Set(approvedRows.map(r => r.indicator_id as string));
    // The set and the lesson must be the ones made for the very class level that was approved, not merely any that also matches the child's class.
    const approvedGrade = new Map(approvedRows.map(r => [r.indicator_id as string,(r.grade as string).toLowerCase()]));
    const indicatorIds = [...new Set([...weakRows.map(w => w.indicatorId),...approvedIds])];
    if (!indicatorIds.length) return { weak: [] as Pick[], approved: [] as Pick[] };
    const sets = (await client.query('SELECT id,indicator_id,source,grade FROM practice_sets WHERE school_id=$1 AND indicator_id=ANY($2::uuid[]) AND retired_at IS NULL',[schoolId,indicatorIds])).rows;
    // A lesson counts only for a topic approved for the child's class, and only the current one.
    const lessons = (await client.query('SELECT id,indicator_id,grade FROM topic_lessons WHERE school_id=$1 AND indicator_id=ANY($2::uuid[]) AND retired_at IS NULL',[schoolId,indicatorIds])).rows;
    const lessonOf = (indicatorId: string) => approvedIds.has(indicatorId) ? (lessons.find(l => l.indicator_id === indicatorId && (l.grade as string).toLowerCase() === approvedGrade.get(indicatorId))?.id as string | undefined) ?? null : null;
    const counts = (await client.query('SELECT set_id,level,count(*)::int AS n FROM practice_questions WHERE school_id=$1 AND set_id=ANY($2::uuid[]) AND retired_at IS NULL GROUP BY set_id,level',[schoolId,sets.map(x => x.id)])).rows;
    const live = (setId: string, level: number) => counts.find(c => c.set_id === setId && c.level === level)?.n ?? 0;
    const pick = (indicatorId: string, subject: string, topic: string): Pick | null => {
      const level = levelOf(indicatorId);
      const written = sets.find(x => x.indicator_id === indicatorId && x.source !== 'generated');
      if (written && live(written.id,level) >= SESSION_SIZE) return { indicatorId, subject, topic, setId: written.id, lessonId: lessonOf(indicatorId) };
      const made = approvedIds.has(indicatorId) ? sets.find(x => x.indicator_id === indicatorId && x.source === 'generated' && (x.grade as string).toLowerCase() === approvedGrade.get(indicatorId)) : undefined;
      return made && live(made.id,level) >= SESSION_SIZE ? { indicatorId, subject, topic, setId: made.id, lessonId: lessonOf(indicatorId) } : null;
    };
    const present = <T,>(list: (T | null)[]) => list.filter((x): x is T => x !== null);
    return { weak: present(weakRows.map(w => pick(w.indicatorId,w.subject,w.topic))),
      approved: present(approvedRows.sort((x,y) => (x.subject as string).localeCompare(y.subject) || (x.topic as string).localeCompare(y.topic)).map(r => pick(r.indicator_id,r.subject,r.topic))) };
  }

  // The topics a teacher's learning notes put first for this student (newest note first), while the note is live and its end date has not passed.
  private async pinned(client: PoolClient, schoolId: string, learnerId: string, today: string) {
    return (await client.query(`SELECT indicator_id FROM learning_notes WHERE school_id=$1 AND learner_id=$2 AND indicator_id IS NOT NULL AND withdrawn_at IS NULL
      AND (focus_until IS NULL OR focus_until>=$3::date) ORDER BY created_at DESC,id`,[schoolId,learnerId,today])).rows.map(r => r.indicator_id as string);
  }

  // The topics offered to the child: those a teacher's note puts first, then the weakest, that have questions to practise and are not finished; three at most.
  // The family sees only the order, never why.
  private offered(picks: { weak: Pick[]; approved: Pick[] }, learned: Learned[], pinned: string[]) {
    // A note's topic leads only while it is approved this term for the child's class, so a pin cannot lift a topic whose approval has been retired.
    const done = new Set(learned.filter(l => l.done).map(l => l.indicatorId)), approved = new Map(picks.approved.map(p => [p.indicatorId,p])), seen = new Set<string>();
    return [...pinned.flatMap(id => approved.get(id) ?? []),...picks.weak].filter(p => !done.has(p.indicatorId) && !seen.has(p.indicatorId) && !!seen.add(p.indicatorId)).slice(0,TOPICS_OFFERED);
  }

  private async classOf(client: PoolClient, schoolId: string, learnerId: string, today: string) {
    const row = (await client.query(`SELECT c.name,c.level FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id
      WHERE e.school_id=$1 AND e.learner_id=$2 AND e.superseded_at IS NULL AND e.start_date<=$3::date AND (e.end_date IS NULL OR e.end_date>$3::date) LIMIT 1`,[schoolId,learnerId,today])).rows[0];
    return row ? { name: row.name as string, level: row.level as string } : null;
  }

  // What the family sees for one child: the topics on offer now, and what the child has practised. No marks, percentages or comparisons.
  async child(client: PoolClient, actor: Actor, learnerId: string) {
    await this.guardianOf(client,actor,learnerId);
    if (!(await this.settings(client,actor.schoolId)).enabled) return {enabled:false as const};
    const today = await accraToday(client);
    // Practice is built on tagged class work, which only Primary and JHS classes have: Nursery and KG families see nothing here.
    const klass = await this.classOf(client,actor.schoolId,learnerId,today);
    if (!klass || (klass.level !== 'Primary' && klass.level !== 'JHS')) return {enabled:false as const};
    const firstName = ((await client.query('SELECT full_name FROM learners WHERE school_id=$1 AND id=$2',[actor.schoolId,learnerId])).rows[0].full_name as string).split(' ')[0]!;
    const learned = await this.learned(client,actor.schoolId,learnerId,today), byTopic = new Map(learned.map(l => [l.indicatorId,l]));
    const picks = await this.available(client,actor.schoolId,learnerId,today,klass.name,id => byTopic.get(id)?.level ?? 1);
    const pinned = await this.pinned(client,actor.schoolId,learnerId,today);
    // A session in progress is always shown so it can be finished; the rest of the slots go to the weakest topics.
    const open = learned.filter(l => l.openSessionId).map(l => ({indicatorId:l.indicatorId,subject:l.subject,topic:l.topic}));
    const offered = [...open,...this.offered(picks,learned,pinned).filter(w => !open.some(o => o.indicatorId === w.indicatorId)).slice(0,Math.max(0,TOPICS_OFFERED - open.length))];
    const lessonIds = new Map([...picks.weak,...picks.approved].map(p => [p.indicatorId,p.lessonId]));
    const card = (o: { indicatorId: string; subject: string; topic: string }) => { const l = byTopic.get(o.indicatorId);
      return {indicatorId:o.indicatorId,subject:o.subject,topic:o.topic,hasLesson:!!lessonIds.get(o.indicatorId),level:l?.level ?? 1,levels:LEVEL_COUNT,sessionsThisWeek:l?.sessionsThisWeek ?? 0,lastPracticedOn:l?.lastPracticedOn ?? null,
        open:l?.openSessionId ? {sessionId:l.openSessionId,answered:l.answeredInOpen,total:SESSION_SIZE} : null,availableToday:!!l?.openSessionId || (l?.sessionsToday ?? 0) < SESSIONS_PER_TOPIC_PER_DAY}; };
    const topics = offered.map(card);
    // The child's own choices: every other topic approved for their class this term that has questions to practise and is not finished.
    const done = new Set(learned.filter(l => l.done).map(l => l.indicatorId)), shown = new Set(offered.map(o => o.indicatorId));
    const explore = picks.approved.filter(a => !shown.has(a.indicatorId) && !done.has(a.indicatorId)).map(card);
    const practised = learned.filter(l => l.lastPracticedOn).sort((a,b) => (b.lastPracticedOn ?? '').localeCompare(a.lastPracticedOn ?? ''))
      .map(l => ({indicatorId:l.indicatorId,subject:l.subject,topic:l.topic,level:l.level,levels:LEVEL_COUNT,done:l.done,sessionsThisWeek:l.sessionsThisWeek,lastPracticedOn:l.lastPracticedOn}));
    return {enabled:true as const,firstName,topics,explore,practised};
  }

  private async view(client: PoolClient, schoolId: string, sessionId: string) {
    const s = (await client.query(`SELECT p.id,p.level,p.completed_at,p.correct,p.outcome,p.level_after,s.name AS subject,i.description AS topic FROM practice_sessions p
      JOIN curriculum_indicators i ON i.school_id=p.school_id AND i.id=p.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id WHERE p.school_id=$1 AND p.id=$2`,[schoolId,sessionId])).rows[0];
    const items = (await client.query(`SELECT it.position,it.question_id,it.answered_at,q.kind,q.prompt,q.options,(ps.source='generated') AS made_by_ai FROM practice_session_items it
      JOIN practice_questions q ON q.school_id=it.school_id AND q.id=it.question_id JOIN practice_sets ps ON ps.school_id=q.school_id AND ps.id=q.set_id WHERE it.school_id=$1 AND it.session_id=$2 ORDER BY it.position`,[schoolId,sessionId])).rows;
    const next = items.find(i => !i.answered_at);
    return {sessionId:s.id as string,subject:s.subject as string,topic:s.topic as string,level:s.level as number,total:items.length,answered:items.filter(i => i.answered_at).length,
      next:next ? {questionId:next.question_id as string,position:next.position as number,kind:next.kind as string,prompt:next.prompt as string,options:next.options as string[] | null,madeByAi:next.made_by_ai as boolean} : null,
      summary:s.completed_at ? {correct:s.correct as number,total:items.length,outcome:s.outcome as string,levelAfter:s.level_after as number} : null};
  }

  async session(client: PoolClient, actor: Actor, learnerId: string, sessionId: string) {
    await this.guardianOf(client,actor,learnerId);
    if (!(await this.settings(client,actor.schoolId)).enabled) throw new NotFoundException('Home practice is not switched on');
    if (!(await client.query('SELECT 1 FROM practice_sessions WHERE school_id=$1 AND id=$2 AND learner_id=$3',[actor.schoolId,sessionId,learnerId])).rowCount) throw new NotFoundException('Session unavailable');
    return this.view(client,actor.schoolId,sessionId);
  }

  // Starts a session at the child's level (or resumes the one in progress). Questions not asked for the longest come first.
  start(client: PoolClient, actor: Actor, learnerId: string, body: StartSessionDto) {
    return command(client,actor,body.operationId,'practice.session.start',{learnerId,...body},async () => {
      await this.guardianOf(client,actor,learnerId);
      if (!(await this.settings(client,actor.schoolId)).enabled) throw new ConflictException('Home practice is not switched on for this school');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`practice:${learnerId}:${body.indicatorId}`]);
      // A check follows a study of the same topic by the same child.
      if (body.studySessionId) {
        const study = (await client.query('SELECT learner_id,indicator_id,finished_at FROM study_sessions WHERE school_id=$1 AND id=$2',[actor.schoolId,body.studySessionId])).rows[0];
        if (!study || study.learner_id !== learnerId) throw new NotFoundException('Study unavailable');
        if (study.indicator_id !== body.indicatorId) throw new BadRequestException('That study was of another topic');
        if (!study.finished_at) throw new BadRequestException('Finish the lesson before its check');
        if ((await client.query('SELECT 1 FROM practice_sessions WHERE school_id=$1 AND study_session_id=$2',[actor.schoolId,body.studySessionId])).rowCount) throw new ConflictException('That lesson already has its check');
      }
      const today = await accraToday(client);
      const everything = await this.learned(client,actor.schoolId,learnerId,today), learned = everything.find(l => l.indicatorId === body.indicatorId);
      if (learned?.openSessionId) return this.view(client,actor.schoolId,learned.openSessionId);
      const klass = await this.classOf(client,actor.schoolId,learnerId,today);
      if (!klass) throw new NotFoundException('This topic is not offered right now');
      const picks = await this.available(client,actor.schoolId,learnerId,today,klass.name,id => everything.find(l => l.indicatorId === id)?.level ?? 1);
      const finished = new Set(everything.filter(l => l.done).map(l => l.indicatorId));
      // Either one of the weakest topics on offer, or any other topic approved for the child's class this term.
      const offered = [...this.offered(picks,everything,await this.pinned(client,actor.schoolId,learnerId,today)),...picks.approved.filter(a => !finished.has(a.indicatorId))].find(w => w.indicatorId === body.indicatorId);
      if (!offered) throw new NotFoundException('This topic is not offered right now');
      if ((learned?.sessionsToday ?? 0) >= SESSIONS_PER_TOPIC_PER_DAY) throw new ConflictException('That is enough practice on this topic for today. Come back tomorrow');
      const level = learned?.level ?? 1;
      const pool = (await client.query(`SELECT q.id,(SELECT max(it.answered_at) FROM practice_session_items it JOIN practice_sessions p ON p.school_id=it.school_id AND p.id=it.session_id
          WHERE it.school_id=q.school_id AND it.question_id=q.id AND p.learner_id=$4) AS last_asked FROM practice_questions q
        WHERE q.school_id=$1 AND q.set_id=$2 AND q.level=$3 AND q.retired_at IS NULL ORDER BY last_asked NULLS FIRST,random() LIMIT $5`,[actor.schoolId,offered.setId,level,learnerId,SESSION_SIZE])).rows as { id: string }[];
      if (pool.length < SESSION_SIZE) throw new ConflictException('This topic does not have enough questions yet');
      const id = randomUUID();
      await client.query('INSERT INTO practice_sessions(id,school_id,learner_id,indicator_id,set_id,guardian_membership_id,level,study_session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,actor.schoolId,learnerId,body.indicatorId,offered.setId,actor.membershipId,level,body.studySessionId ?? null]);
      for (const [n,q] of pool.sort(() => Math.random() - 0.5).entries()) await client.query('INSERT INTO practice_session_items(school_id,session_id,position,question_id) VALUES($1,$2,$3,$4)',[actor.schoolId,id,n + 1,q.id]);
      await audit(client,actor,'practice.session.started',id,{learnerId,indicatorId:body.indicatorId,level});
      return this.view(client,actor.schoolId,id);
    });
  }

  // Marks one answer, tells the child the right answer and why, and completes the session on the fifth.
  answer(client: PoolClient, actor: Actor, learnerId: string, sessionId: string, body: AnswerDto) {
    return command(client,actor,body.operationId,'practice.session.answer',{learnerId,sessionId,...body},async () => {
      await this.guardianOf(client,actor,learnerId);
      if (!(await this.settings(client,actor.schoolId)).enabled) throw new ConflictException('Home practice is not switched on for this school');
      const session = (await client.query('SELECT id,indicator_id,level,completed_at FROM practice_sessions WHERE school_id=$1 AND id=$2 AND learner_id=$3 FOR UPDATE',[actor.schoolId,sessionId,learnerId])).rows[0];
      if (!session) throw new NotFoundException('Session unavailable');
      if (session.completed_at) throw new ConflictException('This session is finished');
      const item = (await client.query(`SELECT it.position,it.answered_at,q.kind,q.options,q.correct_option,q.answer_number::float AS answer,q.explanation FROM practice_session_items it
        JOIN practice_questions q ON q.school_id=it.school_id AND q.id=it.question_id WHERE it.school_id=$1 AND it.session_id=$2 AND it.question_id=$3 FOR UPDATE OF it`,[actor.schoolId,sessionId,body.questionId])).rows[0];
      if (!item) throw new NotFoundException('That question is not in this session');
      if (item.answered_at) throw new ConflictException('That question was already answered');
      let correct: boolean, given: string;
      if (item.kind === 'choice') {
        if (body.choice === undefined || body.choice >= (item.options as string[]).length) throw new BadRequestException('Pick one of the answers');
        correct = body.choice === item.correct_option; given = String(body.choice);
      } else {
        const typed = body.value === undefined ? null : parseNumber(body.value);
        if (typed === null) throw new BadRequestException('Type a number, for example 12 or 0.5');
        correct = sameNumber(typed,item.answer); given = String(typed).slice(0,40);
      }
      await client.query('UPDATE practice_session_items SET given=$4,correct=$5,answered_at=clock_timestamp() WHERE school_id=$1 AND session_id=$2 AND position=$3',[actor.schoolId,sessionId,item.position,given,correct]);
      // A question reported or retired while the child was answering does not count against them: an answer to it is credited.
      const tally = (await client.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE it.answered_at IS NOT NULL)::int AS answered,count(*) FILTER (WHERE it.correct OR (it.answered_at IS NOT NULL AND q.retired_at IS NOT NULL))::int AS right
        FROM practice_session_items it JOIN practice_questions q ON q.school_id=it.school_id AND q.id=it.question_id WHERE it.school_id=$1 AND it.session_id=$2`,[actor.schoolId,sessionId])).rows[0];
      let summary: { correct: number; total: number; outcome: string; levelAfter: number } | null = null;
      if (tally.answered === tally.total) {
        const previous = (await client.query(`SELECT level,correct FROM practice_sessions WHERE school_id=$1 AND learner_id=$2 AND indicator_id=$3 AND completed_at IS NOT NULL ORDER BY completed_at DESC,id DESC LIMIT 1`,[actor.schoolId,learnerId,session.indicator_id])).rows[0] ?? null;
        const result = afterSession(session.level,tally.right,previous);
        await client.query('UPDATE practice_sessions SET completed_at=clock_timestamp(),correct=$3,outcome=$4,level_after=$5 WHERE school_id=$1 AND id=$2',[actor.schoolId,sessionId,tally.right,result.outcome,result.levelAfter]);
        await audit(client,actor,'practice.session.completed',sessionId,{learnerId,indicatorId:session.indicator_id,level:session.level,correct:tally.right,outcome:result.outcome});
        summary = {correct:tally.right,total:tally.total,outcome:result.outcome,levelAfter:result.levelAfter};
      }
      return {correct,correctOption:item.kind === 'choice' ? item.correct_option as number : null,correctNumber:item.kind === 'number' ? item.answer as number : null,explanation:item.explanation as string | null,answered:tally.answered,total:tally.total,summary};
    });
  }

  // ---------------------------------------------------------------- Study: the lesson on the parent's phone, then a check
  // Opens the topic's current lesson for the child, or resumes the one opened in the last half hour (so minutes stay honest). A child can start a topic's lesson three times a day. Only a topic approved for the child's class with
  // a current lesson can be studied. JHS students get the whole lesson on one page; younger children one step at a time (`stage` tells the screen).
  startStudy(client: PoolClient, actor: Actor, learnerId: string, body: StartStudyDto) {
    return command(client,actor,body.operationId,'practice.study.start',{learnerId,...body},async () => {
      await this.guardianOf(client,actor,learnerId);
      if (!(await this.settings(client,actor.schoolId)).enabled) throw new ConflictException('Home practice is not switched on for this school');
      const today = await accraToday(client), klass = await this.classOf(client,actor.schoolId,learnerId,today);
      if (!klass || (klass.level !== 'Primary' && klass.level !== 'JHS')) throw new NotFoundException('This topic has no lesson right now');
      const everything = await this.learned(client,actor.schoolId,learnerId,today);
      const picks = await this.available(client,actor.schoolId,learnerId,today,klass.name,id => everything.find(l => l.indicatorId === id)?.level ?? 1);
      const pick = [...picks.weak,...picks.approved].find(p => p.indicatorId === body.indicatorId && p.lessonId);
      if (!pick) throw new NotFoundException('This topic has no lesson right now');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`study:${learnerId}:${body.indicatorId}`]);
      const lesson = (await client.query('SELECT body FROM topic_lessons WHERE school_id=$1 AND id=$2',[actor.schoolId,pick.lessonId])).rows[0].body;
      const open = (await client.query(`SELECT id FROM study_sessions WHERE school_id=$1 AND learner_id=$2 AND indicator_id=$3 AND lesson_id=$4 AND finished_at IS NULL
        AND started_at>clock_timestamp()-interval '30 minutes' ORDER BY started_at DESC LIMIT 1`,[actor.schoolId,learnerId,body.indicatorId,pick.lessonId])).rows[0]?.id as string | undefined;
      const id = open ?? randomUUID();
      if (!open) {
        const startedToday = (await client.query("SELECT count(*)::int AS n FROM study_sessions WHERE school_id=$1 AND learner_id=$2 AND indicator_id=$3 AND started_at>=(date_trunc('day',now() AT TIME ZONE 'Africa/Accra') AT TIME ZONE 'Africa/Accra')",[actor.schoolId,learnerId,body.indicatorId])).rows[0].n as number;
        if (startedToday >= STUDIES_PER_TOPIC_PER_DAY) throw new ConflictException('That is enough study on this topic for today. Practise it, or come back tomorrow');
        await client.query('INSERT INTO study_sessions(id,school_id,learner_id,indicator_id,lesson_id,guardian_membership_id) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.schoolId,learnerId,body.indicatorId,pick.lessonId,actor.membershipId]);
        await audit(client,actor,'practice.study.started',id,{learnerId,indicatorId:body.indicatorId});
      }
      return {studySessionId:id,indicatorId:body.indicatorId,subject:pick.subject,topic:pick.topic,stage:klass.level === 'JHS' ? 'jhs' as const : stageOf(klass.name),label:AI_LABEL,lessonId:pick.lessonId as string,lesson};
    });
  }

  // The child has reached the end of the lesson. Recorded once; asking again changes nothing. The family is not told the minutes: that is for staff.
  finishStudy(client: PoolClient, actor: Actor, learnerId: string, studySessionId: string, operationId: string) {
    return command(client,actor,operationId,'practice.study.finish',{learnerId,studySessionId},async () => {
      await this.guardianOf(client,actor,learnerId);
      const row = (await client.query('SELECT finished_at FROM study_sessions WHERE school_id=$1 AND id=$2 AND learner_id=$3 FOR UPDATE',[actor.schoolId,studySessionId,learnerId])).rows[0];
      if (!row) throw new NotFoundException('Study unavailable');
      if (!row.finished_at) {
        await client.query('UPDATE study_sessions SET finished_at=clock_timestamp() WHERE school_id=$1 AND id=$2',[actor.schoolId,studySessionId]);
        await audit(client,actor,'practice.study.finished',studySessionId,{learnerId});
      }
      return {finished:true as const};
    });
  }

  // ---------------------------------------------------------------- what staff see: evidence beside class work, never part of CA or reports
  // Per learner and topic: the level the child is at now (from their latest finished session), and sessions finished in the window.
  private async evidence(client: PoolClient, schoolId: string, learnerIds: string[], today: string, from: string, to: string) {
    return (await client.query(`WITH done AS (SELECT p.* FROM practice_sessions p WHERE p.school_id=$1 AND p.learner_id=ANY($2::uuid[]) AND p.completed_at IS NOT NULL),
        latest AS (SELECT DISTINCT ON (learner_id,indicator_id) learner_id,indicator_id,outcome,level_after FROM done ORDER BY learner_id,indicator_id,completed_at DESC,id DESC),
        agg AS (SELECT learner_id,indicator_id,count(*) FILTER (WHERE (completed_at AT TIME ZONE 'Africa/Accra')::date BETWEEN $4::date AND $5::date)::int AS sessions,
          count(*) FILTER (WHERE (completed_at AT TIME ZONE 'Africa/Accra')::date>=$3::date)::int AS this_week,max(completed_at) AS last_at FROM done GROUP BY learner_id,indicator_id)
      SELECT a.learner_id,a.indicator_id,s.name AS subject,i.description AS topic,l.outcome,l.level_after,a.sessions,a.this_week,a.last_at FROM agg a
      JOIN latest l ON l.learner_id=a.learner_id AND l.indicator_id=a.indicator_id JOIN curriculum_indicators i ON i.school_id=$1 AND i.id=a.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      ORDER BY a.last_at DESC`,[schoolId,learnerIds,mondayOf(today),from,to])).rows.map(r => ({learnerId:r.learner_id as string,subject:r.subject as string,topic:r.topic as string,level:r.level_after as number,levels:LEVEL_COUNT,
        done:r.outcome === 'done',sessions:r.sessions as number,sessionsThisWeek:r.this_week as number,lastPracticedOn:new Date(r.last_at).toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'})}));
  }

  // One learner's home practice, for the headteacher and the learner's live class teachers (the learner page).
  async staffLearner(client: PoolClient, actor: Actor, learnerId: string) {
    await this.progress.learnerFor(client,actor,learnerId);
    const today = await accraToday(client);
    const topics = (await this.evidence(client,actor.schoolId,[learnerId],today,'1900-01-01','9999-12-31')).map(({learnerId: _, ...t}) => t);
    const recent = (await client.query(`SELECT p.id,(p.completed_at AT TIME ZONE 'Africa/Accra')::date::text AS on,s.name AS subject,i.description AS topic,p.level,p.correct,p.outcome,p.level_after FROM practice_sessions p
      JOIN curriculum_indicators i ON i.school_id=p.school_id AND i.id=p.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE p.school_id=$1 AND p.learner_id=$2 AND p.completed_at IS NOT NULL ORDER BY p.completed_at DESC,p.id LIMIT 8`,[actor.schoolId,learnerId])).rows
      .map(r => ({id:r.id as string,on:r.on as string,subject:r.subject as string,topic:r.topic as string,level:r.level as number,correct:r.correct as number,total:SESSION_SIZE,outcome:r.outcome as string,levelAfter:r.level_after as number}));
    const unfinished = (await client.query('SELECT count(*)::int AS n FROM practice_sessions WHERE school_id=$1 AND learner_id=$2 AND completed_at IS NULL',[actor.schoolId,learnerId])).rows[0].n as number;
    // Lessons the child finished, with the check that followed, if any. Minutes are capped at half an hour: a page left open is not that long a study.
    const studies = (await client.query(`SELECT st.id,(st.finished_at AT TIME ZONE 'Africa/Accra')::date::text AS on,s.name AS subject,i.description AS topic,
        LEAST(30,round(extract(epoch FROM (st.finished_at-st.started_at))/60))::int AS minutes,c.correct FROM study_sessions st
      JOIN curriculum_indicators i ON i.school_id=st.school_id AND i.id=st.indicator_id JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      LEFT JOIN LATERAL (SELECT p.correct FROM practice_sessions p WHERE p.school_id=st.school_id AND p.study_session_id=st.id AND p.completed_at IS NOT NULL ORDER BY p.completed_at DESC LIMIT 1) c ON true
      WHERE st.school_id=$1 AND st.learner_id=$2 AND st.finished_at IS NOT NULL ORDER BY st.finished_at DESC,st.id LIMIT 8`,[actor.schoolId,learnerId])).rows
      .map(r => ({id:r.id as string,on:r.on as string,subject:r.subject as string,topic:r.topic as string,minutes:r.minutes as number,check:r.correct === null ? null : {correct:r.correct as number,total:SESSION_SIZE}}));
    return {enabled:(await this.settings(client,actor.schoolId)).enabled,topics,recent,unfinished,studies};
  }

  // What a child has learned, to revisit: for the verified guardian (nothing while the school has home practice switched off) and for staff who teach the child today.
  async familyHistory(client: PoolClient, actor: Actor, learnerId: string) {
    await this.guardianOf(client,actor,learnerId);
    if (!(await this.settings(client,actor.schoolId)).enabled) return {enabled:false as const,items:[]};
    return {enabled:true as const,items:await historyList(client,actor.schoolId,learnerId,false)};
  }
  async familyHistoryEntry(client: PoolClient, actor: Actor, learnerId: string, kind: string, id: string) {
    await this.guardianOf(client,actor,learnerId);
    if (!(await this.settings(client,actor.schoolId)).enabled) throw new ConflictException('Home practice is not switched on for this school');
    return historyEntry(client,actor.schoolId,learnerId,kind,id,false);
  }
  async staffHistory(client: PoolClient, actor: Actor, learnerId: string) {
    await this.progress.learnerFor(client,actor,learnerId);
    return {enabled:(await this.settings(client,actor.schoolId)).enabled,items:await historyList(client,actor.schoolId,learnerId,true)};
  }
  async staffHistoryEntry(client: PoolClient, actor: Actor, learnerId: string, kind: string, id: string) {
    await this.progress.learnerFor(client,actor,learnerId);
    return historyEntry(client,actor.schoolId,learnerId,kind,id,true);
  }

  // A class's home practice for the term: who has practised, on what, at which level, and how recently.
  async staffClass(client: PoolClient, actor: Actor, classId: string, termId: string) {
    await this.assessment.classFor(client,actor,classId); // the headteacher, or a teacher assigned to the class today
    const term = await this.assessment.term(client,actor.schoolId,termId);
    const roster = (await this.assessment.learners(client,actor.schoolId,classId,term)).filter(l => !l.left);
    const today = await accraToday(client);
    const rows = roster.length ? (await this.evidence(client,actor.schoolId,roster.map(l => l.id),today,term.start_date,term.end_date)).filter(r => r.sessions > 0) : [];
    const learners = roster.map(l => { const own = rows.filter(r => r.learnerId === l.id);
      return {learnerId:l.id,fullName:l.full_name as string,sessionsThisWeek:own.reduce((n,r) => n + r.sessionsThisWeek,0),sessionsTerm:own.reduce((n,r) => n + r.sessions,0),
        lastPracticedOn:own.map(r => r.lastPracticedOn).sort().reverse()[0] ?? null,topics:own.map(({learnerId: _, ...t}) => t)}; });
    return {enabled:(await this.settings(client,actor.schoolId)).enabled,weekStart:mondayOf(today),
      practisingThisWeek:learners.filter(l => l.sessionsThisWeek > 0).length,practisedThisTerm:learners.filter(l => l.sessionsTerm > 0).length,total:learners.length,learners};
  }
}
