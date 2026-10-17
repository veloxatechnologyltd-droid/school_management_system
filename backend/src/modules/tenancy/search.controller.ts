import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { Access } from '../../core/access';

class SearchDto { @IsString() @MinLength(2) @MaxLength(80) q!: string; }
const today = "(now() AT TIME ZONE 'Africa/Accra')::date";

@Controller('api/v1/schools/:schoolId')
export class SearchController {
  constructor(private readonly access: Access) {}
  // The year and term running today for the top bar, or the next term during a holiday. Read-only, for every member.
  @Get('context')
  context(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,null,async client => {
      const year = (await client.query(`SELECT name FROM academic_years WHERE school_id=$1 AND start_date<=${today} AND end_date>=${today} ORDER BY start_date DESC LIMIT 1`,[schoolId])).rows[0];
      const term = (await client.query(`SELECT t.name,y.name AS year_name,t.start_date::text,t.end_date::text,(${today}-t.start_date)/7+1 AS week
        FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 AND t.start_date<=${today} AND t.end_date>=${today} ORDER BY t.start_date DESC LIMIT 1`,[schoolId])).rows[0];
      const next = term ? null : (await client.query(`SELECT t.name,y.name AS year_name,t.start_date::text FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id
        WHERE t.school_id=$1 AND t.start_date>${today} ORDER BY t.start_date LIMIT 1`,[schoolId])).rows[0];
      return {yearName:term?.year_name ?? year?.name ?? null,term:term ? {name:term.name,startDate:term.start_date,endDate:term.end_date,week:Number(term.week)} : null,nextTerm:next ? {name:next.name,yearName:next.year_name,startDate:next.start_date} : null};
    });
  }
  // One search box for the office: students for every staff role (a teacher finds only the students in classes they teach today),
  // parents for the headteacher, receipts by number for the headteacher and accountant. A few of each, best match first.
  @Get('search')
  search(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: SearchDto) {
    return this.access.school(req,schoolId,['headteacher','teacher','accountant','frontdesk'],async (client,actor) => {
      const text = query.q.trim(), like = `%${text.replace(/[\\%_]/g,'\\$&')}%`, starts = `${text.replace(/[\\%_]/g,'\\$&')}%`;
      const teacherOnly = actor.role === 'teacher' ? `AND EXISTS (SELECT 1 FROM enrolments e JOIN teaching_assignments t ON t.school_id=e.school_id AND t.class_id=e.class_id
        WHERE e.school_id=l.school_id AND e.learner_id=l.id AND e.superseded_at IS NULL AND e.start_date<=${today} AND (e.end_date IS NULL OR e.end_date>${today})
        AND t.teacher_membership_id=$4 AND t.revoked_at IS NULL AND t.start_date<=${today} AND t.end_date>${today})` : '';
      const students = (await client.query(`SELECT l.id,l.full_name,l.admission_number,
          (SELECT c.name FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id WHERE e.school_id=l.school_id AND e.learner_id=l.id AND e.superseded_at IS NULL
            AND e.start_date<=${today} AND (e.end_date IS NULL OR e.end_date>${today}) ORDER BY e.start_date DESC LIMIT 1) AS class_name
        FROM learners l WHERE l.school_id=$1 AND (l.full_name ILIKE $2 ESCAPE '\\' OR l.admission_number ILIKE $2 ESCAPE '\\') ${teacherOnly}
        ORDER BY (l.full_name ILIKE $3 ESCAPE '\\' OR l.admission_number ILIKE $3 ESCAPE '\\') DESC,l.full_name,l.id LIMIT 6`,
        actor.role === 'teacher' ? [schoolId,like,starts,actor.membershipId] : [schoolId,like,starts])).rows;
      const parents = actor.role !== 'headteacher' ? [] : (await client.query(`SELECT g.guardian_display_name AS name,string_agg(l.full_name,', ' ORDER BY l.full_name) AS children
        FROM guardian_links g JOIN learners l ON l.school_id=g.school_id AND l.id=g.learner_id WHERE g.school_id=$1 AND g.revoked_at IS NULL AND g.guardian_display_name ILIKE $2 ESCAPE '\\'
        GROUP BY g.guardian_display_name ORDER BY (g.guardian_display_name ILIKE $3 ESCAPE '\\') DESC,g.guardian_display_name LIMIT 6`,[schoolId,like,starts])).rows;
      const number = /^(?:no\.?\s*)?0*(\d{1,9})$/i.exec(text)?.[1];
      const receipts = !number || !['headteacher','accountant'].includes(actor.role) ? [] : (await client.query(`SELECT p.id,p.receipt_number,p.amount_pesewas::float8 AS amount_pesewas,p.received_on::text,l.full_name,
          EXISTS (SELECT 1 FROM payment_reversals r WHERE r.school_id=p.school_id AND r.payment_id=p.id) AS reversed
        FROM payments p JOIN invoices i ON i.school_id=p.school_id AND i.id=p.invoice_id JOIN learners l ON l.school_id=i.school_id AND l.id=i.learner_id
        WHERE p.school_id=$1 AND p.receipt_number=$2`,[schoolId,Number(number)])).rows;
      return {students,parents,receipts};
    });
  }
}
