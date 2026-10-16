import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { Neighbour, QuestionBody, runChecks, stageOf } from '../content/checks';
import { ApproveTopicsDto, FlagQuestionDto, HandleFlagDto, ReasonDto } from './learning.dto';
import { validateLesson } from './lesson';
import { Scope, accraToday, allows, allowsTopic, classLabel, gradeChoices, scopeOf } from './scope';

export const TARGET_PER_LEVEL = 20;
// A parent can report this many questions a day: enough for a real problem, too few to strip a topic.
export const REPORTS_PER_PARENT_PER_DAY = 10;
export const AI_LABEL = "Made by AI from your school's topics";
const REASONS: Record<string, string> = { wrong_answer: 'the answer looks wrong', unclear: 'the question is unclear', not_taught: 'it is not what the class learned', other: 'another reason' };
const LESSON_REASONS: Record<string, string> = { wrong_answer: 'something in it looks wrong', unclear: 'the lesson is unclear', not_taught: 'it is not what the class learned', other: 'another reason' };

type QuestionRow = { id: string; level: number; kind: 'choice' | 'number'; prompt: string; options: string[] | null; correct_option: number | null; answer: number | null; explanation: string | null;
  retired_at: Date | null; retired_cause: string | null; retirement_reason: string | null };
const shape = (q: QuestionRow) => ({ id: q.id, level: q.level, kind: q.kind, prompt: q.prompt, options: q.options, correctOption: q.correct_option, answer: q.answer, explanation: q.explanation,
  retired: q.retired_at ? { at: q.retired_at, cause: q.retired_cause, reason: q.retirement_reason } : null });
const bodyOf = (q: QuestionRow): QuestionBody => ({ kind: q.kind, prompt: q.prompt, options: q.options, correctOption: q.correct_option, answer: q.answer, explanation: q.explanation });
const QUESTION_COLUMNS = 'q.id,q.level,q.kind,q.prompt,q.options,q.correct_option,q.answer_number::float AS answer,q.explanation,q.retired_at,q.retired_cause,q.retirement_reason';

// The term's topics: approving them is the one human approval. Everything Claude then makes from them can be read and retired by the school's
// teachers, and a parent's report stops a question at once. Staff see only the class levels they teach (the headteacher sees all).
@Injectable()
export class TopicsService {
  // ------------------------------------------------------------------ the topic list and approval
  async topics(client: PoolClient, actor: Actor, termId?: string) {
    const today = await accraToday(client);
    const terms = (await client.query(`SELECT t.id,t.name,t.start_date::text AS start_date,t.end_date::text AS end_date,y.name AS year_name FROM terms t
      JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 ORDER BY t.start_date DESC,t.id`,[actor.schoolId])).rows;
    const term = termId ? terms.find(t => t.id === termId) : terms.find(t => t.start_date <= today && today <= t.end_date) ?? terms.find(t => t.start_date <= today) ?? terms[0];
    if (!term) throw new NotFoundException('Term unavailable');
    const scope = await scopeOf(client,actor), choices = await gradeChoices(client,actor.schoolId,scope);
    const indicators = (await client.query(`SELECT i.id,i.code,i.strand,i.sub_strand,i.description,i.grade,s.name AS subject FROM curriculum_indicators i JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE i.school_id=$1 AND i.retired_at IS NULL ORDER BY s.name,i.grade NULLS FIRST,i.code NULLS LAST,i.created_at,i.id`,[actor.schoolId])).rows.filter(i => allowsTopic(scope,i.grade));
    const ids = indicators.map(i => i.id as string);
    const approvals = (await client.query(`SELECT id,indicator_id,grade,approved_by_name,approved_at FROM topic_approvals WHERE school_id=$1 AND term_id=$2 AND retired_at IS NULL AND indicator_id=ANY($3::uuid[]) ORDER BY approved_at,id`,
      [actor.schoolId,term.id,ids])).rows.filter(a => allows(scope,a.grade));
    const status = await this.contentStatus(client,actor.schoolId,ids);
    return {
      terms: terms.map(t => ({ id: t.id, name: t.name, yearName: t.year_name, startDate: t.start_date, endDate: t.end_date, current: t.start_date <= today && today <= t.end_date })),
      term: { id: term.id, name: term.name, yearName: term.year_name, startDate: term.start_date, endDate: term.end_date, ended: term.end_date < today },
      gradeChoices: choices.mine, canApprove: choices.mine.length > 0 || scope.all, target: TARGET_PER_LEVEL,
      openFlags: (await this.openFlags(client,actor,scope)).length,
      topics: indicators.map(i => ({ indicatorId: i.id, subject: i.subject, code: i.code, strand: i.strand, subStrand: i.sub_strand, description: i.description, grade: i.grade,
        approvals: approvals.filter(a => a.indicator_id === i.id).map(a => ({ id: a.id, grade: a.grade, approvedByName: a.approved_by_name, approvedAt: a.approved_at, content: status(i.id,a.grade) })) })),
    };
  }

  // What has been made for each topic and class level: a current lesson, live questions per level, and reports not yet handled.
  private async contentStatus(client: PoolClient, schoolId: string, indicatorIds: string[]) {
    const counts = (await client.query(`SELECT s.indicator_id,lower(s.grade) AS grade,q.level,count(*)::int AS n FROM practice_sets s JOIN practice_questions q ON q.school_id=s.school_id AND q.set_id=s.id
      WHERE s.school_id=$1 AND s.source='generated' AND s.retired_at IS NULL AND q.retired_at IS NULL AND s.indicator_id=ANY($2::uuid[]) GROUP BY 1,2,3`,[schoolId,indicatorIds])).rows;
    const lessons = (await client.query('SELECT indicator_id,lower(grade) AS grade FROM topic_lessons WHERE school_id=$1 AND retired_at IS NULL AND indicator_id=ANY($2::uuid[])',[schoolId,indicatorIds])).rows;
    const flags = (await client.query(`SELECT s.indicator_id,lower(coalesce(s.grade,i.grade)) AS grade,count(*)::int AS n FROM content_flags f JOIN practice_questions q ON q.school_id=f.school_id AND q.id=f.question_id
      JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id JOIN curriculum_indicators i ON i.school_id=s.school_id AND i.id=s.indicator_id
      WHERE f.school_id=$1 AND f.handled_at IS NULL AND s.indicator_id=ANY($2::uuid[]) GROUP BY 1,2`,[schoolId,indicatorIds])).rows;
    // Reports that name a lesson count for the lesson's topic and class level.
    flags.push(...(await client.query(`SELECT l.indicator_id,lower(l.grade) AS grade,count(*)::int AS n FROM content_flags f JOIN topic_lessons l ON l.school_id=f.school_id AND l.id=f.lesson_id
      WHERE f.school_id=$1 AND f.handled_at IS NULL AND l.indicator_id=ANY($2::uuid[]) GROUP BY 1,2`,[schoolId,indicatorIds])).rows);
    return (indicatorId: string, grade: string) => {
      const g = grade.toLowerCase();
      return { lesson: lessons.some(l => l.indicator_id === indicatorId && l.grade === g),
        levels: [1,2,3].map(level => counts.find(c => c.indicator_id === indicatorId && c.grade === g && c.level === level)?.n ?? 0), target: TARGET_PER_LEVEL,
        openFlags: flags.filter(f => f.indicator_id === indicatorId && (f.grade === null || f.grade === g)).reduce((n,f) => n + f.n,0) };
    };
  }

  approve(client: PoolClient, actor: Actor, body: ApproveTopicsDto) {
    return command(client,actor,body.operationId,'learning.topics.approve',body,async () => {
      const term = (await client.query('SELECT end_date::text AS end_date FROM terms WHERE school_id=$1 AND id=$2',[actor.schoolId,body.termId])).rows[0];
      if (!term) throw new NotFoundException('Term unavailable');
      if (term.end_date < await accraToday(client)) throw new ConflictException('That term has ended. Choose the current term or one still to come');
      const scope = await scopeOf(client,actor), choices = await gradeChoices(client,actor.schoolId,scope);
      const wanted = new Map<string, { indicatorId: string; grade: string }>();
      // Every item is checked before any is approved, so one that is refused approves nothing.
      for (const item of body.items) {
        const indicator = (await client.query('SELECT grade FROM curriculum_indicators WHERE school_id=$1 AND id=$2 AND retired_at IS NULL',[actor.schoolId,item.indicatorId])).rows[0];
        if (!indicator) throw new NotFoundException('A topic is unavailable or has been retired');
        let grade: string;
        if (indicator.grade) {
          if (item.grade && item.grade.trim().toLowerCase() !== (indicator.grade as string).trim().toLowerCase()) throw new BadRequestException(`That topic is for ${indicator.grade}`);
          grade = (indicator.grade as string).trim();
        } else {
          if (!item.grade?.trim()) throw new BadRequestException('Choose the class level for a topic that does not name one');
          grade = item.grade.trim();
          if (!choices.schoolWide.some(name => name.toLowerCase() === grade.toLowerCase())) throw new BadRequestException('Choose a class level your school has');
          grade = choices.schoolWide.find(name => name.toLowerCase() === grade.toLowerCase())!;
        }
        if (!allows(scope,grade)) throw new ForbiddenException('That topic is not for your classes');
        wanted.set(`${item.indicatorId}:${grade.toLowerCase()}`,{ indicatorId: item.indicatorId, grade });
      }
      const approved: { approvalId: string; indicatorId: string; grade: string }[] = []; let already = 0;
      for (const { indicatorId, grade } of wanted.values()) {
        const id = randomUUID();
        // Two people approving the same topic at once: the second finds it already approved.
        const made = await client.query('INSERT INTO topic_approvals(id,school_id,term_id,indicator_id,grade,approved_by,approved_by_name) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(school_id,term_id,indicator_id,lower(grade)) WHERE retired_at IS NULL DO NOTHING',
          [id,actor.schoolId,body.termId,indicatorId,grade,actor.membershipId,actor.displayName?.trim() || 'Staff member']);
        if (made.rowCount) approved.push({ approvalId: id, indicatorId, grade }); else already++;
      }
      if (approved.length) await audit(client,actor,'learning.topics.approved',body.termId,{ approved: approved.length, topics: approved.map(a => ({ indicatorId: a.indicatorId, grade: a.grade })) });
      return { approved, alreadyApproved: already };
    });
  }

  // Retiring a topic for the term stops more being made. What exists is kept, and approving the topic again brings it back as it was.
  retireApproval(client: PoolClient, actor: Actor, approvalId: string, body: ReasonDto) {
    return command(client,actor,body.operationId,'learning.approval.retire',{approvalId,...body},async () => {
      const a = (await client.query('SELECT grade,indicator_id,retired_at FROM topic_approvals WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,approvalId])).rows[0];
      if (!a || a.retired_at || !allows(await scopeOf(client,actor),a.grade)) throw new NotFoundException('Topic approval unavailable or already retired');
      await client.query('UPDATE topic_approvals SET retired_at=clock_timestamp(),retired_by=$3,retirement_reason=$4 WHERE school_id=$1 AND id=$2',[actor.schoolId,approvalId,actor.membershipId,body.reason.trim()]);
      await audit(client,actor,'learning.approval.retired',approvalId,{ indicatorId: a.indicator_id, grade: a.grade, reason: body.reason.trim() });
      return { retired: true };
    });
  }

  // ------------------------------------------------------------------ what Claude made, for teachers to read
  async content(client: PoolClient, actor: Actor, indicatorId: string, grade: string) {
    const indicator = (await client.query(`SELECT i.id,i.code,i.strand,i.sub_strand,i.description,i.grade,s.name AS subject FROM curriculum_indicators i JOIN subjects s ON s.school_id=i.school_id AND s.id=i.subject_id
      WHERE i.school_id=$1 AND i.id=$2`,[actor.schoolId,indicatorId])).rows[0];
    if (!indicator || !allows(await scopeOf(client,actor),grade)) throw new NotFoundException('Topic unavailable');
    const lesson = (await client.query('SELECT id,body,created_at FROM topic_lessons WHERE school_id=$1 AND indicator_id=$2 AND lower(grade)=lower($3) AND retired_at IS NULL',[actor.schoolId,indicatorId,grade])).rows[0];
    const questions = (await client.query(`SELECT ${QUESTION_COLUMNS} FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id
      WHERE s.school_id=$1 AND s.indicator_id=$2 AND s.source='generated' AND lower(s.grade)=lower($3) ORDER BY q.level,q.position`,[actor.schoolId,indicatorId,grade])).rows as QuestionRow[];
    const flags = (await client.query(`SELECT f.id,f.question_id,f.reason,f.note,f.created_at,f.handled_at,f.outcome FROM content_flags f WHERE f.school_id=$1 AND f.question_id=ANY($2::uuid[]) ORDER BY f.created_at,f.id`,
      [actor.schoolId,questions.map(q => q.id)])).rows;
    const approved = (await client.query('SELECT 1 FROM topic_approvals WHERE school_id=$1 AND indicator_id=$2 AND lower(grade)=lower($3) AND retired_at IS NULL',[actor.schoolId,indicatorId,grade])).rowCount! > 0;
    return { label: AI_LABEL, approved, grade, indicator: { id: indicator.id, subject: indicator.subject, code: indicator.code, strand: indicator.strand, subStrand: indicator.sub_strand, description: indicator.description, grade: indicator.grade },
      lesson: lesson ? { id: lesson.id, createdAt: lesson.created_at, body: lesson.body } : null, questions: questions.map(shape),
      flags: flags.map(f => ({ id: f.id, questionId: f.question_id, reason: f.reason, note: f.note, createdAt: f.created_at, handledAt: f.handled_at, outcome: f.outcome })) };
  }

  // A teacher retires any generated question or lesson for a class they teach, at any time, with a reason. Nothing is changed or deleted.
  retireQuestion(client: PoolClient, actor: Actor, questionId: string, body: ReasonDto) {
    return command(client,actor,body.operationId,'learning.question.retire',{questionId,...body},async () => {
      const q = (await client.query(`SELECT q.retired_at,s.source,s.grade,s.indicator_id FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id
        WHERE q.school_id=$1 AND q.id=$2 FOR UPDATE OF q`,[actor.schoolId,questionId])).rows[0];
      if (!q || q.retired_at || q.source !== 'generated' || !allows(await scopeOf(client,actor),q.grade)) throw new NotFoundException('Question unavailable or already retired');
      await client.query("UPDATE practice_questions SET retired_at=clock_timestamp(),retired_by=$3,retired_cause='teacher',retirement_reason=$4 WHERE school_id=$1 AND id=$2",[actor.schoolId,questionId,actor.membershipId,body.reason.trim()]);
      await audit(client,actor,'learning.question.retired',questionId,{ indicatorId: q.indicator_id, grade: q.grade, reason: body.reason.trim() });
      return { retired: true };
    });
  }
  retireLesson(client: PoolClient, actor: Actor, lessonId: string, body: ReasonDto) {
    return command(client,actor,body.operationId,'learning.lesson.retire',{lessonId,...body},async () => {
      const l = (await client.query('SELECT grade,indicator_id,retired_at FROM topic_lessons WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,lessonId])).rows[0];
      if (!l || l.retired_at || !allows(await scopeOf(client,actor),l.grade)) throw new NotFoundException('Lesson unavailable or already retired');
      await client.query("UPDATE topic_lessons SET retired_at=clock_timestamp(),retired_by=$3,retired_cause='teacher',retirement_reason=$4 WHERE school_id=$1 AND id=$2",[actor.schoolId,lessonId,actor.membershipId,body.reason.trim()]);
      await audit(client,actor,'learning.lesson.retired',lessonId,{ indicatorId: l.indicator_id, grade: l.grade, reason: body.reason.trim() });
      return { retired: true };
    });
  }

  // ------------------------------------------------------------------ parents' reports
  // Reports not yet handled, for the class levels the person teaches: reports on questions and on lessons together, oldest first. The parent who raised
  // one is never named.
  private async openFlags(client: PoolClient, actor: Actor, scope: Scope) {
    const questions = (await client.query(`SELECT f.id AS flag_id,f.reason,f.note,f.created_at,${QUESTION_COLUMNS},s.source,coalesce(s.grade,i.grade) AS grade,i.id AS indicator_id,i.description,subj.name AS subject
      FROM content_flags f JOIN practice_questions q ON q.school_id=f.school_id AND q.id=f.question_id JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id
      JOIN curriculum_indicators i ON i.school_id=s.school_id AND i.id=s.indicator_id JOIN subjects subj ON subj.school_id=i.school_id AND subj.id=i.subject_id
      WHERE f.school_id=$1 AND f.handled_at IS NULL`,[actor.schoolId])).rows.map(r => ({ ...r, target: 'question' as const }));
    const lessons = (await client.query(`SELECT f.id AS flag_id,f.reason,f.note,f.created_at,l.id AS lesson_id,l.body,l.retired_at,l.retired_cause,l.retirement_reason,l.grade,i.id AS indicator_id,i.description,subj.name AS subject
      FROM content_flags f JOIN topic_lessons l ON l.school_id=f.school_id AND l.id=f.lesson_id JOIN curriculum_indicators i ON i.school_id=l.school_id AND i.id=l.indicator_id
      JOIN subjects subj ON subj.school_id=i.school_id AND subj.id=i.subject_id WHERE f.school_id=$1 AND f.handled_at IS NULL`,[actor.schoolId])).rows.map(r => ({ ...r, target: 'lesson' as const }));
    return [...questions,...lessons].filter(r => allowsTopic(scope,r.grade)).sort((a,b) => +new Date(a.created_at) - +new Date(b.created_at) || String(a.flag_id).localeCompare(String(b.flag_id)));
  }
  async flags(client: PoolClient, actor: Actor) {
    const rows = await this.openFlags(client,actor,await scopeOf(client,actor));
    return { items: rows.map(r => ({ id: r.flag_id, reason: r.reason, note: r.note, createdAt: r.created_at, target: r.target,
      question: r.target === 'question' ? { ...shape(r as unknown as QuestionRow), source: r.source } : null,
      lesson: r.target === 'lesson' ? { id: r.lesson_id, goal: (r.body as { goal: string }).goal, steps: (r.body as { steps: { heading: string; text: string }[] }).steps, retired: r.retired_at ? { cause: r.retired_cause, reason: r.retirement_reason } : null } : null,
      topic: { indicatorId: r.indicator_id, subject: r.subject, description: r.description, grade: r.grade } })) };
  }
  handleFlag(client: PoolClient, actor: Actor, flagId: string, body: HandleFlagDto) {
    return command(client,actor,body.operationId,'learning.flag.handle',{flagId,...body},async () => {
      const f = (await client.query('SELECT handled_at,question_id,lesson_id FROM content_flags WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,flagId])).rows[0];
      const named = f && !f.handled_at ? (f.question_id
        ? (await client.query(`SELECT coalesce(s.grade,i.grade) AS grade FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id JOIN curriculum_indicators i ON i.school_id=s.school_id AND i.id=s.indicator_id WHERE q.school_id=$1 AND q.id=$2`,[actor.schoolId,f.question_id])).rows[0]
        : (await client.query('SELECT grade FROM topic_lessons WHERE school_id=$1 AND id=$2',[actor.schoolId,f.lesson_id])).rows[0]) : null;
      if (!named || !allowsTopic(await scopeOf(client,actor),named.grade)) throw new NotFoundException('Report unavailable or already handled');
      await client.query('UPDATE content_flags SET handled_at=clock_timestamp(),handled_by=$3,outcome=$4,handled_note=$5 WHERE school_id=$1 AND id=$2',[actor.schoolId,flagId,actor.membershipId,body.outcome,body.note?.trim() || null]);
      await audit(client,actor,'learning.flag.handled',flagId,{ outcome: body.outcome });
      return { handled: true };
    });
  }

  // A verified guardian with the academic right reports a question their own child was given. The question is retired in the same
  // transaction, so it is never given again; then the rest of that topic is checked again.
  flagQuestion(client: PoolClient, actor: Actor, learnerId: string, questionId: string, body: FlagQuestionDto) {
    return command(client,actor,body.operationId,'learning.question.flag',{learnerId,questionId,...body},async () => {
      if (!(await client.query('SELECT 1 FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rowCount)
        throw new NotFoundException('Child unavailable');
      if (!(await client.query(`SELECT 1 FROM practice_session_items i JOIN practice_sessions p ON p.school_id=i.school_id AND p.id=i.session_id WHERE i.school_id=$1 AND i.question_id=$2 AND p.learner_id=$3 LIMIT 1`,[actor.schoolId,questionId,learnerId])).rowCount)
        throw new NotFoundException('Question unavailable');
      // One person's reports are serialised, so the daily allowance cannot be beaten by sending several at once.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`flag:${actor.schoolId}:${actor.membershipId}`]);
      // A report already made is the same report, however often it is sent.
      if ((await client.query('SELECT 1 FROM content_flags WHERE school_id=$1 AND question_id=$2 AND raised_by=$3',[actor.schoolId,questionId,actor.membershipId])).rowCount) return { flagged: true };
      await this.withinDailyAllowance(client,actor);
      const q = (await client.query(`SELECT q.retired_at,s.indicator_id FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id WHERE q.school_id=$1 AND q.id=$2 FOR UPDATE OF q`,[actor.schoolId,questionId])).rows[0];
      await client.query('INSERT INTO content_flags(id,school_id,question_id,raised_by,reason,note) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,questionId,actor.membershipId,body.reason,body.note?.trim() || null]);
      // The question records that it was reported, not who reported it: the parent's identity stays on the report row.
      if (!q.retired_at) await client.query("UPDATE practice_questions SET retired_at=clock_timestamp(),retired_cause='flag',retirement_reason=$3 WHERE school_id=$1 AND id=$2 AND retired_at IS NULL",[actor.schoolId,questionId,`Reported by a parent: ${REASONS[body.reason]}`]);
      const rechecked = await this.recheck(client,actor.schoolId,q.indicator_id);
      await audit(client,actor,'learning.question.flagged',questionId,{ indicatorId: q.indicator_id, reason: body.reason, rechecked });
      return { flagged: true };
    });
  }

  // Reporting a lesson follows the same rules as reporting a question: a verified guardian with the academic right, a lesson their own child was shown,
  // one report per person, ten reports a day across questions and lessons together. The lesson is retired in the same transaction.
  flagLesson(client: PoolClient, actor: Actor, learnerId: string, lessonId: string, body: FlagQuestionDto) {
    return command(client,actor,body.operationId,'learning.lesson.flag',{learnerId,lessonId,...body},async () => {
      if (!(await client.query('SELECT 1 FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rowCount)
        throw new NotFoundException('Child unavailable');
      if (!(await client.query('SELECT 1 FROM study_sessions WHERE school_id=$1 AND lesson_id=$2 AND learner_id=$3 LIMIT 1',[actor.schoolId,lessonId,learnerId])).rowCount) throw new NotFoundException('Lesson unavailable');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`flag:${actor.schoolId}:${actor.membershipId}`]);
      if ((await client.query('SELECT 1 FROM content_flags WHERE school_id=$1 AND lesson_id=$2 AND raised_by=$3',[actor.schoolId,lessonId,actor.membershipId])).rowCount) return { flagged: true };
      await this.withinDailyAllowance(client,actor);
      const l = (await client.query('SELECT retired_at,indicator_id FROM topic_lessons WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,lessonId])).rows[0];
      await client.query('INSERT INTO content_flags(id,school_id,lesson_id,raised_by,reason,note) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,lessonId,actor.membershipId,body.reason,body.note?.trim() || null]);
      if (!l.retired_at) await client.query("UPDATE topic_lessons SET retired_at=clock_timestamp(),retired_cause='flag',retirement_reason=$3 WHERE school_id=$1 AND id=$2 AND retired_at IS NULL",[actor.schoolId,lessonId,`Reported by a parent: ${LESSON_REASONS[body.reason]}`]);
      const rechecked = await this.recheck(client,actor.schoolId,l.indicator_id);
      await audit(client,actor,'learning.lesson.flagged',lessonId,{ indicatorId: l.indicator_id, reason: body.reason, rechecked });
      return { flagged: true };
    });
  }
  private async withinDailyAllowance(client: PoolClient, actor: Actor) {
    const today = (await client.query("SELECT count(*)::int AS n FROM content_flags WHERE school_id=$1 AND raised_by=$2 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'Africa/Accra') AT TIME ZONE 'Africa/Accra')",[actor.schoolId,actor.membershipId])).rows[0].n as number;
    if (today >= REPORTS_PER_PARENT_PER_DAY) throw new HttpException('You have already made ten reports today. Please tell the teacher about anything else, or try again tomorrow',429);
  }

  // The automatic checks run again over what is still live for the topic (questions, then the lesson). Anything that now fails is retired by
  // the checks. Wording a teacher wrote is not touched.
  async recheck(client: PoolClient, schoolId: string, indicatorId: string) {
    const indicator = (await client.query('SELECT description FROM curriculum_indicators WHERE school_id=$1 AND id=$2',[schoolId,indicatorId])).rows[0];
    const sets = (await client.query("SELECT id,grade FROM practice_sets WHERE school_id=$1 AND indicator_id=$2 AND source='generated' AND retired_at IS NULL",[schoolId,indicatorId])).rows;
    const written = (await client.query("SELECT q.prompt FROM practice_questions q JOIN practice_sets s ON s.school_id=q.school_id AND s.id=q.set_id WHERE s.school_id=$1 AND s.indicator_id=$2 AND s.source<>'generated' AND s.retired_at IS NULL AND q.retired_at IS NULL",[schoolId,indicatorId])).rows;
    let retired = 0;
    for (const set of sets) {
      const seen: Neighbour[] = written.map((w,n) => ({ itemId: `written-${n}`, text: w.prompt as string }));
      // Rows another request is already changing are left to it (SKIP LOCKED), and a row is only retired if it is still live, so two reports on one
      // topic at once cannot trip over each other.
      const rows = (await client.query(`SELECT ${QUESTION_COLUMNS} FROM practice_questions q WHERE q.school_id=$1 AND q.set_id=$2 AND q.retired_at IS NULL ORDER BY q.level,q.position FOR UPDATE OF q SKIP LOCKED`,[schoolId,set.id])).rows as QuestionRow[];
      const stage = stageOf(await classLabel(client,schoolId,set.grade));
      for (const q of rows) {
        const refused = runChecks('question',stage,bodyOf(q),seen).findings.find(f => f.blocking);
        if (refused) {
          retired += (await client.query("UPDATE practice_questions SET retired_at=clock_timestamp(),retired_cause='check',retirement_reason=$3 WHERE school_id=$1 AND id=$2 AND retired_at IS NULL",[schoolId,q.id,refused.message.slice(0,280)])).rowCount ?? 0;
        } else seen.push({ itemId: q.id, text: q.prompt });
      }
      const lesson = (await client.query('SELECT id,body FROM topic_lessons WHERE school_id=$1 AND indicator_id=$2 AND lower(grade)=lower($3) AND retired_at IS NULL FOR UPDATE SKIP LOCKED',[schoolId,indicatorId,set.grade])).rows[0];
      if (lesson) {
        const again = validateLesson(JSON.stringify({ lesson: lesson.body }),indicator.description,await classLabel(client,schoolId,set.grade));
        if (!again.ok) retired += (await client.query("UPDATE topic_lessons SET retired_at=clock_timestamp(),retired_cause='check',retirement_reason=$3 WHERE school_id=$1 AND id=$2 AND retired_at IS NULL",[schoolId,lesson.id,`The lesson no longer passes the checks (${again.reason})`])).rowCount ?? 0;
      }
    }
    return retired;
  }
}
