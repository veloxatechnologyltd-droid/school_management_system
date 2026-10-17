import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PASS_LINE } from '../assessment/progress.service';
import { dueSql, paidSql } from '../finance/finance.service';

const LEVELS = ['Nursery', 'KG', 'Primary', 'JHS'] as const;
class OverviewQueryDto {
  @IsOptional() @IsUUID() termId?: string;
  @IsOptional() @IsIn(LEVELS) level?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsIn(['today', 'week', 'term']) period?: 'today' | 'week' | 'term';
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) day?: string;
}
const shift = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
const mondayOf = (day: string) => shift(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const pct = (part: number, whole: number) => whole > 0 ? Math.round(part * 1000 / whole) / 10 : null;
const round1 = (n: number | null) => n === null ? null : Math.round(n * 10) / 10;
type Tally = { present: number; away: number; marked: number };
const tally = (rows: { present: number; away: number }[]): Tally => rows.reduce<Tally>((t, r) => ({ present: t.present + r.present, away: t.away + r.away, marked: t.marked + r.present + r.away }), { present: 0, away: 0, marked: 0 });

// The headteacher's school-at-a-glance in one request, narrowed by term, level or class and a period: enrolment, attendance,
// fees, scores and admissions. Only submitted registers count, and fees leave out reversed payments, as everywhere else.
@Controller('api/v1/schools/:schoolId/home')
export class OverviewController {
  constructor(private readonly access: Access) {}
  @Get('overview')
  overview(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: OverviewQueryDto) {
    return this.access.school(req,schoolId,['headteacher'],async client => {
      const today = query.day ?? (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS day")).rows[0].day as string;
      const terms = (await client.query(`SELECT t.id,t.name,t.start_date::text AS start,t.end_date::text AS "end",y.name AS year_name,(t.start_date<=$2 AND t.end_date>=$2) AS current
        FROM terms t JOIN academic_years y ON y.school_id=t.school_id AND y.id=t.academic_year_id WHERE t.school_id=$1 ORDER BY t.start_date DESC,t.id`,[schoolId,today])).rows as
        { id: string; name: string; start: string; end: string; year_name: string; current: boolean }[];
      if (query.termId && !terms.some(t => t.id === query.termId)) throw new NotFoundException('Term unavailable');
      const term = terms.find(t => t.id === query.termId) ?? terms.find(t => t.current) ?? terms.find(t => t.start <= today) ?? terms[terms.length - 1] ?? null;
      if (!term) return { day: today, term: null, terms: [], classes: [], levels: LEVELS };

      const options = (await client.query(`SELECT c.id,c.name,c.level,c.capacity FROM class_sections c JOIN terms t ON t.school_id=c.school_id AND t.academic_year_id=c.academic_year_id AND t.id=$2
        WHERE c.school_id=$1 ORDER BY c.name,c.id`,[schoolId,term.id])).rows as { id: string; name: string; level: string; capacity: number }[];
      const chosen = options.find(c => c.id === query.classId);
      const scope = options.filter(c => chosen ? c.id === chosen.id : !query.level || c.level === query.level), ids = scope.map(c => c.id);
      const level = chosen ? null : query.level ?? null;

      // The roll is read on today, or on the term's first or last day when the term is not running.
      const inTerm = today >= term.start && today <= term.end;
      const asOf = today < term.start ? term.start : today > term.end ? term.end : today;
      const lastDay = asOf;
      const period = query.period === 'term' || !inTerm ? 'term' : query.period ?? 'week';
      const from = period === 'today' ? today : period === 'week' ? (mondayOf(today) > term.start ? mondayOf(today) : term.start) : term.start;
      const to = period === 'term' ? lastDay : today;

      const roll = (await client.query(`SELECT e.class_id,count(*)::int AS n,count(*) FILTER (WHERE l.sex='female')::int AS female,count(*) FILTER (WHERE l.sex='male')::int AS male
        FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id
        WHERE e.school_id=$1 AND e.class_id=ANY($2::uuid[]) AND e.superseded_at IS NULL AND e.start_date<=$3 AND (e.end_date IS NULL OR e.end_date>$3) GROUP BY e.class_id`,[schoolId,ids,asOf])).rows as
        { class_id: string; n: number; female: number; male: number }[];
      const learnersIn = new Map(roll.map(r => [r.class_id, r.n]));
      const students = { total: roll.reduce((s, r) => s + r.n, 0), female: roll.reduce((s, r) => s + r.female, 0), male: roll.reduce((s, r) => s + r.male, 0), asOf,
        byLevel: LEVELS.map(name => ({ level: name, count: scope.filter(c => c.level === name).reduce((s, c) => s + (learnersIn.get(c.id) ?? 0), 0) })).filter(row => row.count > 0) };
      const named = scope.filter(c => (learnersIn.get(c.id) ?? 0) > 0);

      // Attendance: one row per class and day from the term's start, so any window and its predecessor come from the same rows.
      const marks = (await client.query(`SELECT r.day::text AS day,r.class_id,count(*) FILTER (WHERE m.mark IN ('present','late'))::int AS present,count(*) FILTER (WHERE m.mark IN ('absent','excused'))::int AS away
        FROM attendance_registers r JOIN attendance_marks m ON m.school_id=r.school_id AND m.register_id=r.id
        WHERE r.school_id=$1 AND r.class_id=ANY($2::uuid[]) AND r.status IN ('submitted','locked') AND r.day BETWEEN $3 AND $4 GROUP BY r.day,r.class_id`,[schoolId,ids,term.start,lastDay])).rows as
        { day: string; class_id: string; present: number; away: number }[];
      const within = (a: string, b: string) => marks.filter(r => r.day >= a && r.day <= b);
      const days = [...new Set(marks.map(r => r.day))].sort();
      const daily = days.map(day => { const t = tally(marks.filter(r => r.day === day)); return { day, rate: pct(t.present, t.marked), marked: t.marked, away: t.away, registers: marks.filter(r => r.day === day).length }; });
      const now = tally(within(from, to));
      // The comparison: today against the last day with registers before it, the week against the week before, nothing for a whole term.
      let before: Tally | null = null, beforeLabel = '';
      if (period === 'today') { const last = days.filter(d => d < today).pop(); if (last) { before = tally(within(last, last)); beforeLabel = last; } }
      else if (period === 'week') { const start = shift(mondayOf(today), -7), rows = within(start, shift(mondayOf(today), -1)); if (rows.length) { before = tally(rows); beforeLabel = 'last week'; } }
      let registers: { expected: number; in: number; waiting: string[] } | null = null;
      if (inTerm && (await client.query('SELECT 1 FROM school_days WHERE school_id=$1 AND day=$2 AND is_open',[schoolId,today])).rowCount) {
        const todays = new Set(marks.filter(r => r.day === today).map(r => r.class_id));
        registers = { expected: named.length, in: named.filter(c => todays.has(c.id)).length, waiting: named.filter(c => !todays.has(c.id)).map(c => c.name) };
      }
      const attendance = { from, to, rate: pct(now.present, now.marked), present: now.present, away: now.away, marked: now.marked, daysCounted: new Set(within(from, to).map(r => r.day)).size,
        previousRate: before ? pct(before.present, before.marked) : null, previousLabel: beforeLabel, registers, daily,
        byClass: named.map(c => { const t = tally(within(from, to).filter(r => r.class_id === c.id)); return { classId: c.id, name: c.name, level: c.level, learners: learnersIn.get(c.id) ?? 0, rate: pct(t.present, t.marked), away: t.away, marked: t.marked }; })
          .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name)) };

      // Fees on this term's invoices: what was billed and collected per class, what came in during the window, and each week's receipts.
      const bills = (await client.query(`SELECT c.id AS class_id,c.name,c.level,count(*)::int AS invoices,coalesce(sum(${dueSql}),0)::float8 AS billed,coalesce(sum(${paidSql}),0)::float8 AS collected
        FROM invoices i JOIN class_sections c ON c.school_id=i.school_id AND c.id=i.class_id WHERE i.school_id=$1 AND i.term_id=$2 AND i.class_id=ANY($3::uuid[]) GROUP BY c.id,c.name,c.level`,[schoolId,term.id,ids])).rows as
        { class_id: string; name: string; level: string; invoices: number; billed: number; collected: number }[];
      const receipts = (await client.query(`SELECT p.received_on::text AS day,p.amount_pesewas::float8 AS amount FROM payments p JOIN invoices i ON i.school_id=p.school_id AND i.id=p.invoice_id
        WHERE p.school_id=$1 AND i.term_id=$2 AND i.class_id=ANY($3::uuid[]) AND NOT EXISTS (SELECT 1 FROM payment_reversals v WHERE v.school_id=p.school_id AND v.payment_id=p.id)`,[schoolId,term.id,ids])).rows as { day: string; amount: number }[];
      const billed = bills.reduce((s, b) => s + b.billed, 0), collected = bills.reduce((s, b) => s + b.collected, 0);
      const weeks: { week: string; collectedPesewas: number }[] = [];
      for (let week = mondayOf(term.start); week <= (to > term.start ? to : term.start) && week <= term.end; week = shift(week, 7)) weeks.push({ week, collectedPesewas: receipts.filter(r => r.day >= week && r.day <= shift(week, 6)).reduce((s, r) => s + r.amount, 0) });
      const fees = { billedPesewas: billed, collectedPesewas: collected, outstandingPesewas: billed - collected, rate: pct(collected, billed), invoices: bills.reduce((s, b) => s + b.invoices, 0),
        inPeriodPesewas: period === 'term' ? collected : receipts.filter(r => r.day >= from && r.day <= to).reduce((s, r) => s + r.amount, 0), weeks,
        byClass: bills.map(b => ({ classId: b.class_id, name: b.name, level: b.level, billedPesewas: b.billed, collectedPesewas: b.collected, outstandingPesewas: b.billed - b.collected, rate: pct(b.collected, b.billed) }))
          .sort((a, b) => b.outstandingPesewas - a.outstandingPesewas || a.name.localeCompare(b.name)) };

      // Scores: the latest CA and exam entry per student and subject, for students on the roll. A subject counts once a score exists in the class.
      const latest = `roll AS (SELECT e.class_id,e.learner_id FROM enrolments e WHERE e.school_id=$1 AND e.class_id=ANY($3::uuid[]) AND e.superseded_at IS NULL AND e.start_date<=$4 AND (e.end_date IS NULL OR e.end_date>$4)),
        latest AS (SELECT DISTINCT ON (x.class_id,x.subject_id,x.learner_id,x.kind) x.class_id,x.subject_id,x.learner_id,x.kind,x.score FROM assessment_score_entries x
          WHERE x.school_id=$1 AND x.term_id=$2 AND x.class_id=ANY($3::uuid[]) ORDER BY x.class_id,x.subject_id,x.learner_id,x.kind,x.created_at DESC,x.id DESC),
        kept AS (SELECT l.* FROM latest l JOIN roll r ON r.class_id=l.class_id AND r.learner_id=l.learner_id)`;
      const bySubject = (await client.query(`WITH ${latest} SELECT k.class_id,k.subject_id,s.name,count(*) FILTER (WHERE k.kind='ca')::int AS ca_n,count(*) FILTER (WHERE k.kind='exam')::int AS exam_n,
          coalesce(sum(k.score) FILTER (WHERE k.kind='ca'),0)::float8 AS ca_sum,coalesce(sum(k.score) FILTER (WHERE k.kind='exam'),0)::float8 AS exam_sum
        FROM kept k JOIN subjects s ON s.school_id=$1 AND s.id=k.subject_id GROUP BY k.class_id,k.subject_id,s.name`,[schoolId,term.id,ids,asOf])).rows as
        { class_id: string; subject_id: string; name: string; ca_n: number; exam_n: number; ca_sum: number; exam_sum: number }[];
      const below = (await client.query(`WITH ${latest} SELECT class_id,count(*)::int AS scored,count(*) FILTER (WHERE mean<${PASS_LINE})::int AS below
        FROM (SELECT class_id,learner_id,avg(score) AS mean FROM kept GROUP BY class_id,learner_id) m GROUP BY class_id`,[schoolId,term.id,ids,asOf])).rows as { class_id: string; scored: number; below: number }[];
      const average = (sum: number, n: number) => n ? round1(sum / n) : null;
      const scoreClasses = named.filter(c => c.level === 'Primary' || c.level === 'JHS' || bySubject.some(r => r.class_id === c.id)).map(c => {
        const rows = bySubject.filter(r => r.class_id === c.id), learners = learnersIn.get(c.id) ?? 0, started = rows.length, b = below.find(x => x.class_id === c.id);
        return { classId: c.id, name: c.name, level: c.level, learners, subjects: started, expected: started * learners * 2, entered: rows.reduce((s, r) => s + r.ca_n + r.exam_n, 0),
          caAverage: average(rows.reduce((s, r) => s + r.ca_sum, 0), rows.reduce((s, r) => s + r.ca_n, 0)), examAverage: average(rows.reduce((s, r) => s + r.exam_sum, 0), rows.reduce((s, r) => s + r.exam_n, 0)),
          scored: b?.scored ?? 0, belowPass: b?.below ?? 0 };
      });
      const subjects = [...new Set(bySubject.map(r => r.subject_id))].map(id => {
        const rows = bySubject.filter(r => r.subject_id === id), expected = rows.reduce((s, r) => s + (learnersIn.get(r.class_id) ?? 0) * 2, 0);
        return { subjectId: id, name: rows[0].name, classes: rows.length, expected, entered: rows.reduce((s, r) => s + r.ca_n + r.exam_n, 0),
          caAverage: average(rows.reduce((s, r) => s + r.ca_sum, 0), rows.reduce((s, r) => s + r.ca_n, 0)), examAverage: average(rows.reduce((s, r) => s + r.exam_sum, 0), rows.reduce((s, r) => s + r.exam_n, 0)) };
      }).sort((a, b) => a.name.localeCompare(b.name));
      const startedClasses = scoreClasses.filter(c => c.subjects > 0);
      const scores = { passLine: PASS_LINE, expected: startedClasses.reduce((s, c) => s + c.expected, 0), entered: startedClasses.reduce((s, c) => s + c.entered, 0), classes: scoreClasses.length, started: startedClasses.length,
        belowPass: scoreClasses.reduce((s, c) => s + c.belowPass, 0), scored: scoreClasses.reduce((s, c) => s + c.scored, 0), byClass: scoreClasses, bySubject: subjects };

      // Admissions are not tied to a term; they are narrowed by the same class or level.
      const pipeline = (await client.query(`SELECT a.status,count(*)::int AS n FROM admissions a JOIN class_sections c ON c.school_id=a.school_id AND c.id=a.class_id
        WHERE a.school_id=$1 AND a.status IN ('application','review','offered','waitlisted','accepted') AND ($2::uuid IS NULL OR a.class_id=$2) AND ($3::text IS NULL OR $2::uuid IS NOT NULL OR c.level=$3) GROUP BY a.status`,
        [schoolId,chosen?.id ?? null,level])).rows as { status: string; n: number }[];
      const count = (status: string) => pipeline.find(r => r.status === status)?.n ?? 0;
      const admissions = { application: count('application'), review: count('review'), offered: count('offered'), waitlisted: count('waitlisted'), accepted: count('accepted'), waiting: count('application') + count('review') };
      const capacity = scope.map(c => ({ classId: c.id, name: c.name, level: c.level, capacity: c.capacity, enrolled: learnersIn.get(c.id) ?? 0 }))
        .sort((a, b) => b.enrolled / b.capacity - a.enrolled / a.capacity || a.name.localeCompare(b.name));

      return { day: today, term: { id: term.id, name: term.name, yearName: term.year_name, start: term.start, end: term.end, current: inTerm }, terms, classes: options.map(c => ({ id: c.id, name: c.name, level: c.level })), levels: LEVELS,
        scope: { level, classId: chosen?.id ?? null, classes: scope.length }, period, requestedPeriod: query.period ?? 'week', students, attendance, fees, scores, admissions, capacity };
    });
  }
}
