import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { IsDateString, IsOptional, Matches } from 'class-validator';
import { Request } from 'express';
import { Access } from '../../core/access';

class MorningQueryDto {
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) day?: string;
}
const kept = `NOT EXISTS (SELECT 1 FROM payment_reversals v WHERE v.school_id=p.school_id AND v.payment_id=p.id)`;
// The headteacher's morning view in one request: registers not taken today, learners absent 3+ days this week with their
// guardian's contact, fees collected this week against the same week of last term, and missing scores in the current term.
@Controller('api/v1/schools/:schoolId/home')
export class MorningController {
  constructor(private readonly access: Access) {}
  @Get('morning')
  morning(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: MorningQueryDto) {
    return this.access.school(req,schoolId,['headteacher'],async client => {
      // Dates: the week runs Monday to the given day; a term is current when it contains the day.
      const when = (await client.query(`
        WITH d AS (SELECT coalesce($2::date,(now() AT TIME ZONE 'Africa/Accra')::date) AS day)
        SELECT d.day::text,(d.day-(extract(isodow FROM d.day)::int-1))::text AS week_start,
          EXISTS (SELECT 1 FROM school_days s WHERE s.school_id=$1 AND s.day=d.day AND s.is_open) AS open,
          t.id AS term_id,t.name AS term_name,t.start_date::text AS term_start,t.end_date::text AS term_end,(t.end_date-d.day) AS days_left,
          p.name AS previous_name,p.start_date::text AS previous_start
        FROM d LEFT JOIN LATERAL (SELECT * FROM terms WHERE school_id=$1 AND start_date<=d.day AND end_date>=d.day ORDER BY start_date DESC LIMIT 1) t ON true
        LEFT JOIN LATERAL (SELECT * FROM terms WHERE school_id=$1 AND end_date<t.start_date ORDER BY start_date DESC LIMIT 1) p ON true`,[schoolId,query.day ?? null])).rows[0];
      const {day,week_start:weekStart} = when;

      const registers = when.open ? (await client.query(`
        SELECT c.id AS class_id,c.name,coalesce(r.status,'missing') AS status
        FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id AND y.start_date<=$2 AND y.end_date>$2
        LEFT JOIN attendance_registers r ON r.school_id=c.school_id AND r.class_id=c.id AND r.day=$2
        WHERE c.school_id=$1 AND coalesce(r.status,'missing') IN ('missing','draft')
          AND EXISTS (SELECT 1 FROM enrolments e WHERE e.school_id=c.school_id AND e.class_id=c.id AND e.superseded_at IS NULL AND e.start_date<=$2 AND (e.end_date IS NULL OR e.end_date>$2))
        ORDER BY c.name,c.id`,[schoolId,day])).rows : [];

      // Absences from submitted or locked registers; the guardian shown is a verified contact, with the phone on their account.
      const absences = (await client.query(`
        SELECT l.id AS learner_id,l.full_name,a.class_name,a.absences,a.last_absent_day,g.guardian_name,g.phone
        FROM (SELECT m.learner_id,min(c.name) AS class_name,count(*)::int AS absences,max(r.day)::text AS last_absent_day
          FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id AND r.status IN ('submitted','locked')
          JOIN class_sections c ON c.school_id=r.school_id AND c.id=r.class_id
          WHERE m.school_id=$1 AND m.mark='absent' AND r.day BETWEEN $2::date AND $3::date GROUP BY m.learner_id HAVING count(*)>=3) a
        JOIN learners l ON l.school_id=$1 AND l.id=a.learner_id
        LEFT JOIN LATERAL (SELECT gl.guardian_display_name AS guardian_name,s.phone FROM guardian_links gl LEFT JOIN staff_list() s ON s.membership_id=gl.guardian_membership_id
          WHERE gl.school_id=$1 AND gl.learner_id=l.id AND gl.contact AND gl.verified_at IS NOT NULL AND gl.revoked_at IS NULL
          ORDER BY s.phone IS NULL,gl.created_at,gl.id LIMIT 1) g ON true
        ORDER BY a.absences DESC,l.full_name,l.id`,[schoolId,weekStart,day])).rows;

      // Money received this week (reversed payments excluded), against the same days counted from the start of last term.
      let fees = null;
      if (when.term_id) {
        const from = weekStart > when.term_start ? weekStart : when.term_start;
        const row = (await client.query(`
          WITH w AS (SELECT $2::date AS from_day,$3::date AS to_day,$4::date-$5::date+$2::date AS prev_from,$4::date-$5::date+$3::date AS prev_to)
          SELECT w.prev_from::text,w.prev_to::text,
            coalesce((SELECT sum(p.amount_pesewas) FROM payments p WHERE p.school_id=$1 AND p.received_on BETWEEN w.from_day AND w.to_day AND ${kept}),0)::float8 AS collected,
            coalesce((SELECT sum(p.amount_pesewas) FROM payments p WHERE p.school_id=$1 AND p.received_on BETWEEN w.prev_from AND w.prev_to AND ${kept}),0)::float8 AS previous
          FROM w`,[schoolId,from,day,when.previous_start ?? when.term_start,when.term_start])).rows[0];
        fees = {term:when.term_name,from,to:day,collectedPesewas:row.collected,
          previous:when.previous_start ? {term:when.previous_name,from:row.prev_from,to:row.prev_to,collectedPesewas:row.previous} : null};
      }

      // Scores still to enter: for each class, the subjects already started there need a CA and an exam score for every learner
      // still in the class at term end who has no published report. Primary/JHS classes with no scores at all are listed too.
      let scores = null;
      if (when.term_id) {
        const classes = (await client.query(`
          WITH t AS (SELECT id,academic_year_id,end_date FROM terms WHERE school_id=$1 AND id=$2),
          roll AS (SELECT DISTINCT e.class_id,e.learner_id FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id JOIN t ON t.academic_year_id=c.academic_year_id
            WHERE e.school_id=$1 AND e.superseded_at IS NULL AND e.start_date<t.end_date AND (e.end_date IS NULL OR e.end_date>t.end_date)
              AND NOT EXISTS (SELECT 1 FROM terminal_reports tr WHERE tr.school_id=$1 AND tr.term_id=t.id AND tr.learner_id=e.learner_id)),
          entered AS (SELECT DISTINCT class_id,subject_id,learner_id,kind FROM assessment_score_entries WHERE school_id=$1 AND term_id=$2),
          started AS (SELECT DISTINCT class_id,subject_id FROM entered),
          gaps AS (SELECT r.class_id,st.subject_id,count(*)::int AS missing FROM roll r JOIN started st ON st.class_id=r.class_id CROSS JOIN (VALUES ('ca'),('exam')) k(kind)
            WHERE NOT EXISTS (SELECT 1 FROM entered x WHERE x.class_id=r.class_id AND x.subject_id=st.subject_id AND x.learner_id=r.learner_id AND x.kind=k.kind)
            GROUP BY r.class_id,st.subject_id)
          SELECT c.id AS class_id,c.name,c.level,(SELECT count(*) FROM roll r WHERE r.class_id=c.id)::int AS learners,
            coalesce(sum(g.missing),0)::int AS missing,coalesce(array_agg(s.name ORDER BY s.name) FILTER (WHERE s.name IS NOT NULL),'{}') AS subjects,
            NOT EXISTS (SELECT 1 FROM started st WHERE st.class_id=c.id) AS not_started
          FROM class_sections c JOIN t ON t.academic_year_id=c.academic_year_id
          LEFT JOIN gaps g ON g.class_id=c.id LEFT JOIN subjects s ON s.school_id=c.school_id AND s.id=g.subject_id
          WHERE c.school_id=$1 GROUP BY c.id,c.name,c.level ORDER BY c.name,c.id`,[schoolId,when.term_id])).rows
          .filter(row => row.learners > 0 && (row.missing > 0 || (row.not_started && (row.level === 'Primary' || row.level === 'JHS'))));
        scores = {term:when.term_name,endsOn:when.term_end,daysLeft:when.days_left,classes};
      }
      // Support plans whose review falls on or before the day and that are still open.
      const support = (await client.query(`
        SELECT p.id,c.name AS class_name,s.name AS subject_name,p.owner_name,coalesce(lr.next_review_date,p.first_review_date)::text AS review_date,
          (SELECT count(*)::int FROM support_plan_learners x WHERE x.school_id=p.school_id AND x.plan_id=p.id) AS learners
        FROM support_plans p JOIN class_sections c ON c.school_id=p.school_id AND c.id=p.class_id JOIN subjects s ON s.school_id=p.school_id AND s.id=p.subject_id
        LEFT JOIN LATERAL (SELECT r.decision,r.next_review_date FROM support_plan_reviews r WHERE r.school_id=p.school_id AND r.plan_id=p.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) lr ON true
        WHERE p.school_id=$1 AND lr.decision IS DISTINCT FROM 'close' AND coalesce(lr.next_review_date,p.first_review_date)<=$2 ORDER BY 5,c.name,p.id`,[schoolId,day])).rows;
      return {day,weekStart,open:when.open,registers,absences,fees,scores,support};
    });
  }
}
