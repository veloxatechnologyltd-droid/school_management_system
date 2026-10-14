import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { SupportPlanDto, SupportReviewDto } from './assessment.dto';
import { AssessmentService } from './assessment.service';
import { mean } from './progress.service';

const todayInAccra = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
const LIVE = `t.revoked_at IS NULL AND t.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND t.end_date>(now() AT TIME ZONE 'Africa/Accra')::date`;
// Current state of a plan: closed once a review closes it; otherwise due on the latest review's next date, or the first one.
const PLAN_STATE = `(SELECT r.decision='close' FROM support_plan_reviews r WHERE r.school_id=p.school_id AND r.plan_id=p.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) IS TRUE AS closed,
  coalesce((SELECT r.next_review_date FROM support_plan_reviews r WHERE r.school_id=p.school_id AND r.plan_id=p.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1),p.first_review_date)::text AS review_date`;
type Plan = { id: string; class_id: string; subject_id: string; indicator_id: string | null; start_date: string; owner_membership_id: string; learners: { id: string; full_name: string }[] };
type Mark = { class_id: string; subject_id: string; held_on: string; learner_id: string; percent: number; indicators: string[] };

// Each learner's average up to the plan's start and since (to the given day); the group change counts every learner once.
export function evidenceFor(plan: Pick<Plan, 'class_id' | 'subject_id' | 'indicator_id' | 'start_date' | 'learners'>, marks: Mark[], upTo: string) {
  const relevant = marks.filter(m => m.class_id === plan.class_id && m.subject_id === plan.subject_id && (!plan.indicator_id || m.indicators.includes(plan.indicator_id)) && m.held_on <= upTo);
  const learners = plan.learners.map(l => {
    const own = relevant.filter(m => m.learner_id === l.id);
    // Marks on the start day are the starting point (often what prompted the plan); only later marks count as since.
    const before = own.filter(m => m.held_on <= plan.start_date).map(m => m.percent), since = own.filter(m => m.held_on > plan.start_date).map(m => m.percent);
    const b = mean(before), s = mean(since);
    return {learnerId:l.id,fullName:l.full_name,before:b,beforeMarks:before.length,since:s,sinceMarks:since.length,change:b !== null && s !== null ? Math.round((s - b) * 10) / 10 : null};
  });
  const before = mean(learners.flatMap(l => l.before === null ? [] : [l.before])), since = mean(learners.flatMap(l => l.since === null ? [] : [l.since]));
  const both = learners.filter(l => l.change !== null);
  return {upTo,learners,group:{before,since,change:both.length ? mean(both.map(l => l.change!)) : null,improved:both.filter(l => l.change! >= 5).length,dropped:both.filter(l => l.change! <= -5).length,compared:both.length}};
}

@Injectable()
export class SupportService {
  constructor(private readonly assessment: AssessmentService) {}

  // Who may own a plan: the headteacher picks any current teacher or headteacher (class teachers first); a teacher owns their own.
  async owners(client: PoolClient, actor: Actor, classId: string) {
    await this.assessment.classFor(client,actor,classId);
    if (actor.role !== 'headteacher') return {items:[{membershipId:actor.membershipId,name:actor.displayName ?? 'Me',classTeacher:true}]};
    const classTeachers = new Set((await client.query(`SELECT t.teacher_membership_id FROM teaching_assignments t WHERE t.school_id=$1 AND t.class_id=$2 AND ${LIVE}`,[actor.schoolId,classId])).rows.map(r => r.teacher_membership_id as string));
    const staff = (await client.query(`SELECT membership_id,display_name,role FROM staff_list() WHERE revoked_at IS NULL AND role IN ('teacher','headteacher') ORDER BY display_name`)).rows;
    return {items:staff.map(s => ({membershipId:s.membership_id,name:s.display_name,role:s.role,classTeacher:classTeachers.has(s.membership_id)}))
      .sort((a,b) => Number(b.classTeacher) - Number(a.classTeacher))};
  }

  create(client: PoolClient, actor: Actor, classId: string, body: SupportPlanDto) {
    return command(client,actor,body.operationId,'assessment.support_plan',{classId,...body},async () => {
      await this.assessment.classFor(client,actor,classId);
      const term = await this.assessment.term(client,actor.schoolId,body.termId);
      if (body.startDate < term.start_date || body.startDate > term.end_date) throw new BadRequestException('The plan must start inside the term');
      if (body.reviewDate <= body.startDate) throw new BadRequestException('The review date must come after the start date');
      if (!(await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2',[actor.schoolId,body.subjectId])).rowCount) throw new NotFoundException('Subject unavailable');
      if (body.indicatorId && !(await client.query('SELECT 1 FROM curriculum_indicators WHERE school_id=$1 AND id=$2 AND subject_id=$3 AND retired_at IS NULL',[actor.schoolId,body.indicatorId,body.subjectId])).rowCount)
        throw new BadRequestException('Choose a current indicator from this subject');
      const learnerIds = [...new Set(body.learnerIds)];
      const eligible = new Set((await this.assessment.learners(client,actor.schoolId,classId,term)).filter(l => !l.left).map(l => l.id));
      if (learnerIds.some(id => !eligible.has(id))) throw new NotFoundException('A learner is not in this class for the term');
      let ownerId = actor.membershipId, ownerName = actor.displayName ?? 'Unknown';
      if (body.ownerMembershipId && body.ownerMembershipId !== actor.membershipId) {
        if (actor.role !== 'headteacher') throw new ForbiddenException('Only the headteacher can give a plan to someone else');
        const owner = (await client.query(`SELECT membership_id,display_name FROM staff_list() WHERE membership_id=$1 AND revoked_at IS NULL AND role IN ('teacher','headteacher')`,[body.ownerMembershipId])).rows[0];
        if (!owner) throw new NotFoundException('That staff member cannot own a plan');
        ownerId = owner.membership_id; ownerName = owner.display_name;
      }
      const id = randomUUID();
      await client.query(`INSERT INTO support_plans(id,school_id,class_id,term_id,subject_id,indicator_id,concern,action,owner_membership_id,owner_name,start_date,first_review_date,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,actor.schoolId,classId,body.termId,body.subjectId,body.indicatorId ?? null,body.concern.trim(),body.action.trim(),ownerId,ownerName,body.startDate,body.reviewDate,actor.membershipId]);
      for (const learnerId of learnerIds) await client.query('INSERT INTO support_plan_learners(school_id,plan_id,learner_id) VALUES($1,$2,$3)',[actor.schoolId,id,learnerId]);
      await audit(client,actor,'assessment.support_plan.created',id,{classId,learners:learnerIds.length,ownerMembershipId:ownerId});
      return {id,ownerName,learners:learnerIds.length};
    });
  }

  private async plans(client: PoolClient, actor: Actor, where: string, params: unknown[]) {
    // Teachers see plans for classes they teach today and plans they own.
    const scope = actor.role === 'headteacher' ? '$2::uuid IS NOT NULL' : `(p.owner_membership_id=$2 OR EXISTS (SELECT 1 FROM teaching_assignments t WHERE t.school_id=p.school_id AND t.class_id=p.class_id AND t.teacher_membership_id=$2 AND ${LIVE}))`;
    if (actor.role !== 'headteacher' && actor.role !== 'teacher') throw new ForbiddenException('Your role cannot perform this action');
    const rows = (await client.query(`SELECT p.id,p.class_id,c.name AS class_name,p.term_id,p.subject_id,s.name AS subject_name,p.indicator_id,i.code AS indicator_code,i.description AS indicator_description,
        p.concern,p.action,p.owner_membership_id,p.owner_name,p.start_date::text,p.first_review_date::text,p.created_at,${PLAN_STATE}
      FROM support_plans p JOIN class_sections c ON c.school_id=p.school_id AND c.id=p.class_id JOIN subjects s ON s.school_id=p.school_id AND s.id=p.subject_id
      LEFT JOIN curriculum_indicators i ON i.school_id=p.school_id AND i.id=p.indicator_id
      WHERE p.school_id=$1 AND ${scope} AND ${where} ORDER BY p.created_at DESC,p.id`,[actor.schoolId,actor.membershipId,...params])).rows;
    const learners = (await client.query(`SELECT x.plan_id,l.id,l.full_name FROM support_plan_learners x JOIN learners l ON l.school_id=x.school_id AND l.id=x.learner_id
      WHERE x.school_id=$1 AND x.plan_id=ANY($2::uuid[]) ORDER BY l.full_name,l.id`,[actor.schoolId,rows.map(r => r.id)])).rows;
    return rows.map(r => ({...r,learners:learners.filter(l => l.plan_id === r.id).map(l => ({id:l.id,full_name:l.full_name}))}));
  }

  private async marksFor(client: PoolClient, schoolId: string, plans: Plan[]) {
    if (!plans.length) return [];
    return (await client.query(`SELECT a.class_id,a.subject_id,a.held_on::text,m.learner_id,round(m.mark*100/a.max_mark,1)::float AS percent,
        coalesce(array_agg(x.indicator_id) FILTER (WHERE x.indicator_id IS NOT NULL),'{}') AS indicators
      FROM class_assessments a JOIN LATERAL (SELECT DISTINCT ON (y.learner_id) y.learner_id,y.mark FROM class_assessment_marks y
        WHERE y.school_id=a.school_id AND y.assessment_id=a.id AND y.learner_id=ANY($4::uuid[]) ORDER BY y.learner_id,y.created_at DESC,y.id DESC) m ON true
      LEFT JOIN class_assessment_indicators x ON x.school_id=a.school_id AND x.assessment_id=a.id
      WHERE a.school_id=$1 AND a.class_id=ANY($2::uuid[]) AND a.subject_id=ANY($3::uuid[])
      GROUP BY a.id,a.class_id,a.subject_id,a.held_on,a.max_mark,m.learner_id,m.mark`,
      [schoolId,[...new Set(plans.map(p => p.class_id))],[...new Set(plans.map(p => p.subject_id))],[...new Set(plans.flatMap(p => p.learners.map(l => l.id)))]])).rows as Mark[];
  }

  async list(client: PoolClient, actor: Actor, filter: { classId?: string; termId?: string; status?: string }) {
    const params: unknown[] = []; const where: string[] = ['true'];
    if (filter.classId) { params.push(filter.classId); where.push(`p.class_id=$${params.length + 2}`); }
    if (filter.termId) { params.push(filter.termId); where.push(`p.term_id=$${params.length + 2}`); }
    const today = todayInAccra();
    const plans = (await this.plans(client,actor,where.join(' AND '),params)).filter(p => filter.status === 'all' || (filter.status === 'closed' ? p.closed : !p.closed));
    const marks = await this.marksFor(client,actor.schoolId,plans);
    return {today,items:plans.map(p => ({...p,due:!p.closed && p.review_date <= today,evidence:evidenceFor(p,marks,today).group}))
      .sort((a,b) => Number(a.closed) - Number(b.closed) || a.review_date.localeCompare(b.review_date))};
  }

  private async plan(client: PoolClient, actor: Actor, planId: string) {
    const plan = (await this.plans(client,actor,'p.id=$3',[planId]))[0];
    if (!plan) throw new NotFoundException('Support plan unavailable');
    return plan;
  }

  async detail(client: PoolClient, actor: Actor, planId: string) {
    const plan = await this.plan(client,actor,planId), today = todayInAccra();
    const reviews = (await client.query(`SELECT r.id,r.reviewed_on::text,r.outcome,r.note,r.decision,r.next_review_date::text,r.evidence,r.created_at,r.recorded_by
      FROM support_plan_reviews r WHERE r.school_id=$1 AND r.plan_id=$2 ORDER BY r.created_at,r.id`,[actor.schoolId,planId])).rows;
    return {...plan,due:!plan.closed && plan.review_date <= today,today,evidence:evidenceFor(plan,await this.marksFor(client,actor.schoolId,[plan]),today),reviews};
  }

  review(client: PoolClient, actor: Actor, planId: string, body: SupportReviewDto) {
    return command(client,actor,body.operationId,'assessment.support_plan.review',{planId,...body},async () => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`support_plan:${planId}`]);
      const plan = await this.plan(client,actor,planId), today = todayInAccra(), reviewedOn = body.reviewedOn ?? today;
      if (plan.closed) throw new ConflictException('This support plan is closed');
      if (reviewedOn < plan.start_date || reviewedOn > today) throw new BadRequestException('The review date must be between the plan\'s start and today');
      if (body.decision === 'continue' && (!body.nextReviewDate || body.nextReviewDate <= reviewedOn)) throw new BadRequestException('Choose the next review date, after this review');
      if (body.decision === 'close' && body.nextReviewDate) throw new BadRequestException('A closed plan has no next review');
      // The evidence seen at the review is kept with it, so later marks never change what the review was based on.
      const evidence = evidenceFor(plan,await this.marksFor(client,actor.schoolId,[plan]),reviewedOn);
      const id = randomUUID();
      await client.query(`INSERT INTO support_plan_reviews(id,school_id,plan_id,reviewed_on,outcome,note,decision,next_review_date,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id,actor.schoolId,planId,reviewedOn,body.outcome,body.note.trim(),body.decision,body.nextReviewDate ?? null,JSON.stringify(evidence),actor.membershipId]);
      await audit(client,actor,'assessment.support_plan.reviewed',planId,{outcome:body.outcome,decision:body.decision});
      return {id,decision:body.decision};
    }).catch(error => { if ((error as {code?:string}).code === '23514' || (error as {code?:string}).code === '23505') throw new ConflictException('This support plan is closed'); throw error; });
  }
}
