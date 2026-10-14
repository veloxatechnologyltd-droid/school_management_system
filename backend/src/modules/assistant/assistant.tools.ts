import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { PoolClient } from 'pg';
import { Actor } from '../../core/access';
import { AssessmentService } from '../assessment/assessment.service';
import { MocksService } from '../assessment/mocks.service';
import { PASS_LINE, ProgressService, mean } from '../assessment/progress.service';
import { SupportService } from '../assessment/support.service';
import { FinanceService } from '../finance/finance.service';

// Read-only tools the school assistant may call. Each runs in its own short transaction as the signed-in person, through the same
// services and class checks as the screens: heads see the school, teachers only the classes they are live-assigned to today.
// Learners never leave the server by name: results carry an opaque reference (learnerRef) that the reply writes as [[ref]] and the
// server turns back into a name for the person asking. Guardian contacts, staff names and free-text notes are not sent.

export const learnerRef = (id: string) => `L-${id}`;
const REF = /\bL-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;
export const refsIn = (text: string) => [...new Set([...text.matchAll(REF)].map(m => m[1]!))];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LIVE = "t.revoked_at IS NULL AND t.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND t.end_date>(now() AT TIME ZONE 'Africa/Accra')::date";
const cedis = (pesewas: number) => Math.round(pesewas) / 100;
const pct = (part: number, whole: number) => whole ? Math.round(part * 1000 / whole) / 10 : null;

type Input = Record<string, unknown>;
type Tool = { def: Anthropic.Tool; roles: string[]; run: (client: PoolClient, actor: Actor, input: Input) => Promise<unknown> };

function text(input: Input, key: string, required = false, max = 120) {
  const v = input[key];
  if (v === undefined || v === null || v === '') { if (required) throw new BadRequestException(`${key} is required`); return undefined; }
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${key} must be text of at most ${max} characters`);
  return v.trim();
}
function day(input: Input, key: string) {
  const v = text(input, key, false, 10);
  if (v !== undefined && (!DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) throw new BadRequestException(`${key} must be a date like 2026-10-05`);
  return v;
}
function choice<T extends string>(input: Input, key: string, options: readonly T[], fallback: T): T {
  const v = text(input, key, false, 20);
  if (v === undefined) return fallback;
  if (!options.includes(v as T)) throw new BadRequestException(`${key} must be one of ${options.join(', ')}`);
  return v as T;
}
const schema = (properties: Record<string, object>, required: string[] = []): Anthropic.Tool.InputSchema => ({ type: 'object', properties, required, additionalProperties: false });
const classProp = { type: 'string', description: 'Class id from school_overview, or the exact class name such as "Basic 6" or "JHS 3".' };
const termProp = { type: 'string', description: 'Term id from school_overview. Leave out for the current term.' };

@Injectable()
export class AssistantTools {
  constructor(private readonly assessment: AssessmentService, private readonly progress: ProgressService, private readonly support: SupportService,
    private readonly mocks: MocksService, private readonly finance: FinanceService) {}

  private async today(client: PoolClient) { return (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS day")).rows[0].day as string; }

  // The term containing today, otherwise the most recent one that has started.
  private async currentTerm(client: PoolClient, schoolId: string) {
    const term = (await client.query(`SELECT id,name,start_date::text,end_date::text FROM terms WHERE school_id=$1 AND start_date<=(now() AT TIME ZONE 'Africa/Accra')::date
      ORDER BY (end_date>=(now() AT TIME ZONE 'Africa/Accra')::date) DESC,start_date DESC LIMIT 1`, [schoolId])).rows[0];
    if (!term) throw new NotFoundException('This school has no term that has started yet');
    return term as { id: string; name: string; start_date: string; end_date: string };
  }
  private async term(client: PoolClient, schoolId: string, input: Input) {
    const id = text(input, 'term_id', false, 40);
    if (!id) return this.currentTerm(client, schoolId);
    if (!UUID.test(id)) throw new BadRequestException('term_id must be a term id from school_overview');
    return this.assessment.term(client, schoolId, id) as Promise<{ id: string; name: string; start_date: string; end_date: string }>;
  }

  // Classes of the academic year containing today that this person may see: all for heads, live assignments for teachers.
  private async classesInScope(client: PoolClient, actor: Actor) {
    const teacher = actor.role === 'teacher';
    return (await client.query(`SELECT c.id,c.name,c.level,
        (SELECT count(*) FROM enrolments e WHERE e.school_id=c.school_id AND e.class_id=c.id AND e.superseded_at IS NULL AND e.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date
          AND (e.end_date IS NULL OR e.end_date>(now() AT TIME ZONE 'Africa/Accra')::date))::int AS learners
      FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id AND y.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND y.end_date>(now() AT TIME ZONE 'Africa/Accra')::date
      WHERE c.school_id=$1 AND (NOT $2 OR EXISTS (SELECT 1 FROM teaching_assignments t WHERE t.school_id=c.school_id AND t.class_id=c.id AND t.teacher_membership_id=$3 AND ${LIVE}))
      ORDER BY c.name,c.id`, [actor.schoolId, teacher, actor.membershipId])).rows as { id: string; name: string; level: string; learners: number }[];
  }
  // A class by id or name, checked by the assessment service (teachers: live assignment only).
  private async classOf(client: PoolClient, actor: Actor, input: Input) {
    const given = text(input, 'class', true)!;
    let id = UUID.test(given) ? given : null;
    if (!id) {
      const want = given.toLowerCase().replace(/\s+/g, ' ');
      const all = await this.classesInScope(client, actor);
      const hit = all.find(c => c.name.toLowerCase() === want) ?? all.find(c => c.name.toLowerCase().replace(/^(basic|class|primary|grade)\s*/, '') === want.replace(/^(basic|class|primary|grade)\s*/, ''));
      if (!hit) throw new NotFoundException(`No class called "${given}" that you can see. Classes: ${all.map(c => c.name).join(', ') || 'none'}`);
      id = hit.id;
    }
    return this.assessment.classFor(client, actor, id) as Promise<{ id: string; name: string; level: string }>;
  }
  private async learnerOf(client: PoolClient, actor: Actor, input: Input) {
    const given = text(input, 'learner', true, 60)!;
    const id = given.replace(/^\[*L-/, '').replace(/\]*$/, '');
    if (!UUID.test(id)) throw new BadRequestException('learner must be a learner reference such as L-… from another tool or find_learner');
    const row = (await client.query(`SELECT l.id FROM learners l WHERE l.school_id=$1 AND l.id=$2 AND ($3::boolean OR EXISTS (SELECT 1 FROM enrolments e JOIN teaching_assignments t ON t.school_id=e.school_id AND t.class_id=e.class_id
        WHERE e.school_id=l.school_id AND e.learner_id=l.id AND e.superseded_at IS NULL AND e.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND (e.end_date IS NULL OR e.end_date>(now() AT TIME ZONE 'Africa/Accra')::date)
        AND t.teacher_membership_id=$4 AND ${LIVE}))`, [actor.schoolId, id, actor.role === 'headteacher', actor.membershipId])).rows[0];
    if (!row) throw new NotFoundException('Learner unavailable to you');
    return id;
  }

  readonly tools: Record<string, Tool> = {
    school_overview: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'school_overview', description: 'Start here. Today\'s date, the current and other terms (ids, dates, days left), and the classes this person can see with their ids, level and number of learners. For a headteacher, also which registers are not yet submitted today.', input_schema: schema({}) },
      run: async (client, actor) => {
        const today = await this.today(client);
        const terms = (await client.query(`SELECT id,name,start_date::text,end_date::text FROM terms WHERE school_id=$1 ORDER BY start_date DESC LIMIT 6`, [actor.schoolId])).rows;
        const current = terms.find(t => t.start_date <= today && t.end_date >= today) ?? null;
        const classes = await this.classesInScope(client, actor);
        let registers: unknown = undefined;
        if (actor.role === 'headteacher') {
          const open = (await client.query('SELECT 1 FROM school_days WHERE school_id=$1 AND day=$2 AND is_open', [actor.schoolId, today])).rowCount! > 0;
          const status = new Map((await client.query('SELECT class_id,status FROM attendance_registers WHERE school_id=$1 AND day=$2', [actor.schoolId, today])).rows.map(r => [r.class_id as string, r.status as string]));
          registers = open ? { schoolDayOpen: true, notSubmitted: classes.filter(c => c.learners > 0 && !['submitted', 'locked'].includes(status.get(c.id) ?? 'missing')).map(c => c.name) } : { schoolDayOpen: false };
        }
        return { today, role: actor.role, currentTerm: current ? { ...current, daysLeft: Math.round((Date.parse(current.end_date) - Date.parse(today)) / 864e5) } : null,
          terms, classes, learnersInScope: classes.reduce((s, c) => s + c.learners, 0), registersToday: registers };
      },
    },

    class_performance: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'class_performance', description: 'How a class is doing from dated class work (exercises, homework, quizzes, class tests; mock exams excluded): class average per subject for each week or month of the term, the overall trend, and learners needing attention (recent average below the 50% pass line, or dropping 10+ points against their own earlier marks). Also the end-of-term report totals per subject when scores have been entered.',
        input_schema: schema({ class: classProp, term_id: termProp, period: { type: 'string', enum: ['week', 'month'], description: 'Bucket size for the trend. Default week.' } }, ['class']) },
      run: async (client, actor, input) => {
        const section = await this.classOf(client, actor, input), term = await this.term(client, actor.schoolId, input), period = choice(input, 'period', ['week', 'month'] as const, 'week');
        const p = await this.progress.classProgress(client, actor, section.id, term.id, period);
        const recent = p.buckets.slice(-8);
        const subjects = p.subjects.map(s => { const pts = s.points.filter(x => recent.includes(x.start) && x.average !== null);
          const all = s.points.filter(x => x.average !== null); return { subject: s.name, termAverage: mean(all.map(x => x.average!)), trend: pts.map(x => ({ from: x.start, average: x.average, marks: x.marks })) }; });
        let reportTotals: unknown = null;
        try {
          const r = await this.assessment.results(client, actor, section.id, term.id);
          const names = [...new Set(r.items.flatMap(i => i.subjects.map(s => s.name)))];
          reportTotals = names.length ? { subjects: names.map(name => { const totals = r.items.filter(i => !i.left).map(i => i.subjects.find(s => s.name === name)?.total).filter((t): t is number => t !== null && t !== undefined);
            return { subject: name, learnersWithTotal: totals.length, average: mean(totals), belowPassLine: totals.filter(t => t < PASS_LINE).length }; }), learnersComplete: r.items.filter(i => i.complete && !i.left).length } : null;
        } catch { reportTotals = null; }
        return { class: section, term: { id: term.id, name: term.name }, period, classSize: p.classSize, overallTrend: p.overall.filter(o => recent.includes(o.start)),
          subjects, needsAttention: p.attention.map(a => ({ learnerRef: learnerRef(a.learnerId), subject: a.subject, reason: a.reason, recentAverage: a.recent, earlierAverage: a.earlier })),
          reportTotals, note: 'Averages are percentages of each assessment\'s maximum mark.' };
      },
    },

    curriculum_gaps: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'curriculum_gaps', description: 'The weakest curriculum indicators (topics) for a class this term, from assessments the teacher tagged with indicators: class average, how many learners are below the 50% pass line and who, and how many practice materials the school has saved for each. Use this to answer "what should we do about it" with the exact topics to reteach.',
        input_schema: schema({ class: classProp, term_id: termProp, subject: { type: 'string', description: 'Optional subject name to narrow to, e.g. "Mathematics".' } }, ['class']) },
      run: async (client, actor, input) => {
        const section = await this.classOf(client, actor, input), term = await this.term(client, actor.schoolId, input);
        let subjectId: string | undefined;
        const subject = text(input, 'subject');
        if (subject) { subjectId = (await client.query('SELECT id FROM subjects WHERE school_id=$1 AND lower(name)=lower($2)', [actor.schoolId, subject])).rows[0]?.id; if (!subjectId) throw new NotFoundException(`No subject called "${subject}"`); }
        const g = await this.progress.gaps(client, actor, section.id, term.id, subjectId);
        return { class: section, term: { id: term.id, name: term.name }, untaggedAssessments: g.untaggedAssessments,
          weakest: g.items.slice(0, 10).map(i => ({ indicatorId: i.indicatorId, subject: i.subject, code: i.code, topic: i.description, strand: i.strand, subStrand: i.subStrand, assessments: i.assessments,
            learnersAssessed: i.learners, classAverage: i.average, belowPassLine: i.belowPass, belowShare: i.belowShare, practiceMaterials: (i as { resources?: number }).resources ?? 0,
            learnersBelow: i.below.slice(0, 12).map(b => ({ learnerRef: learnerRef(b.learnerId), average: b.average })) })),
          indicatorsTracked: g.items.length };
      },
    },

    practice_materials: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'practice_materials', description: 'Practice materials the school saved for one curriculum indicator (worksheets, textbook pages, links, activities), with whether each is shared with families. The indicatorId comes from curriculum_gaps.',
        input_schema: schema({ indicator_id: { type: 'string', description: 'indicatorId from curriculum_gaps.' } }, ['indicator_id']) },
      run: async (client, actor, input) => {
        const id = text(input, 'indicator_id', true, 40)!;
        if (!UUID.test(id)) throw new BadRequestException('indicator_id must be an indicatorId from curriculum_gaps');
        const r = await this.progress.resources(client, actor, id) as { items?: { kind: string; title: string; detail: string | null; url: string | null; for_families: boolean; retired_at: string | null }[] };
        return { materials: (r.items ?? []).filter(m => !m.retired_at).map(m => ({ kind: m.kind, title: m.title, detail: m.detail, link: m.url, sharedWithFamilies: m.for_families })) };
      },
    },

    attendance_report: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'attendance_report', description: 'Attendance between two dates from submitted or locked registers: attendance rate per class, and the learners absent most often (absences, days marked, last absent day). Use for "who has been absent most last week". Dates are inclusive; work out last week as Monday to Friday from today\'s date.',
        input_schema: schema({ from: { type: 'string', description: 'First day, YYYY-MM-DD.' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD.' }, class: { ...classProp, description: 'Optional: one class (id or name). Leave out for every class you can see.' },
          min_absences: { type: 'integer', minimum: 1, maximum: 60, description: 'Only list learners absent at least this many days. Default 1.' } }, ['from', 'to']) },
      run: async (client, actor, input) => {
        const from = day(input, 'from'), to = day(input, 'to');
        if (!from || !to || from > to) throw new BadRequestException('from and to are required, from on or before to');
        if ((Date.parse(to) - Date.parse(from)) / 864e5 > 200) throw new BadRequestException('Ask about at most 200 days at a time');
        const min = typeof input.min_absences === 'number' && Number.isInteger(input.min_absences) ? Math.min(60, Math.max(1, input.min_absences)) : 1;
        const classes = input.class ? [await this.classOf(client, actor, input)] : await this.classesInScope(client, actor);
        const ids = classes.map(c => c.id);
        const perClass = (await client.query(`SELECT r.class_id,count(DISTINCT r.day)::int AS days,count(*) FILTER (WHERE m.mark<>'unmarked')::int AS marked,
            count(*) FILTER (WHERE m.mark IN ('present','late'))::int AS present,count(*) FILTER (WHERE m.mark='late')::int AS late,count(*) FILTER (WHERE m.mark='absent')::int AS absent
          FROM attendance_registers r JOIN attendance_marks m ON m.school_id=r.school_id AND m.register_id=r.id
          WHERE r.school_id=$1 AND r.class_id=ANY($2::uuid[]) AND r.status IN ('submitted','locked') AND r.day BETWEEN $3 AND $4 GROUP BY r.class_id`, [actor.schoolId, ids, from, to])).rows;
        const learners = (await client.query(`SELECT m.learner_id,min(c.name) AS class_name,count(*) FILTER (WHERE m.mark='absent')::int AS absences,count(*) FILTER (WHERE m.mark<>'unmarked')::int AS marked,
            count(*) FILTER (WHERE m.mark='late')::int AS late,(max(r.day) FILTER (WHERE m.mark='absent'))::text AS last_absent
          FROM attendance_registers r JOIN attendance_marks m ON m.school_id=r.school_id AND m.register_id=r.id JOIN class_sections c ON c.school_id=r.school_id AND c.id=r.class_id
          WHERE r.school_id=$1 AND r.class_id=ANY($2::uuid[]) AND r.status IN ('submitted','locked') AND r.day BETWEEN $3 AND $4
          GROUP BY m.learner_id HAVING count(*) FILTER (WHERE m.mark='absent')>=$5 ORDER BY absences DESC,late DESC,m.learner_id LIMIT 25`, [actor.schoolId, ids, from, to, min])).rows;
        const name = new Map(classes.map(c => [c.id, c.name]));
        return { from, to, classes: perClass.map(r => ({ class: name.get(r.class_id), registerDays: r.days, attendanceRate: pct(r.present, r.marked), absences: r.absent, lates: r.late }))
            .sort((a, b) => (a.attendanceRate ?? 101) - (b.attendanceRate ?? 101)),
          classesWithoutRegisters: classes.filter(c => !perClass.some(r => r.class_id === c.id)).map(c => c.name),
          mostAbsent: learners.map(l => ({ learnerRef: learnerRef(l.learner_id), class: l.class_name, absences: l.absences, daysMarked: l.marked, lates: l.late, lastAbsent: l.last_absent })),
          note: 'Only submitted or locked registers count; late counts as present.' };
      },
    },

    find_learner: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'find_learner', description: 'Find learners by part of their name or admission number, among learners this person can see. Returns learner references and current class. Use the reference with learner_profile.',
        input_schema: schema({ query: { type: 'string', description: 'Part of a name or an admission number, at least 2 characters.' } }, ['query']) },
      run: async (client, actor, input) => {
        const q = text(input, 'query', true, 80)!;
        if (q.length < 2) throw new BadRequestException('query needs at least 2 characters');
        const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
        const rows = (await client.query(`SELECT l.id,c.name AS class_name FROM learners l
          LEFT JOIN LATERAL (SELECT e.class_id FROM enrolments e WHERE e.school_id=l.school_id AND e.learner_id=l.id AND e.superseded_at IS NULL AND e.start_date<=(now() AT TIME ZONE 'Africa/Accra')::date
            AND (e.end_date IS NULL OR e.end_date>(now() AT TIME ZONE 'Africa/Accra')::date) ORDER BY e.start_date DESC LIMIT 1) e ON true
          LEFT JOIN class_sections c ON c.school_id=l.school_id AND c.id=e.class_id
          WHERE l.school_id=$1 AND (l.full_name ILIKE $2 ESCAPE '\\' OR l.admission_number ILIKE $2 ESCAPE '\\')
            AND ($3::boolean OR EXISTS (SELECT 1 FROM teaching_assignments t WHERE t.school_id=l.school_id AND t.class_id=e.class_id AND t.teacher_membership_id=$4 AND ${LIVE}))
          ORDER BY l.full_name,l.id LIMIT 10`, [actor.schoolId, like, actor.role === 'headteacher', actor.membershipId])).rows;
        return { matches: rows.map(r => ({ learnerRef: learnerRef(r.id), class: r.class_name ?? 'not currently enrolled' })) };
      },
    },

    learner_profile: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'learner_profile', description: 'One learner: subject averages by term (and recent weeks) from class work and report totals, attendance this term and the last 30 days, support plans, latest mock exam result, and for a headteacher the fee balance this term.',
        input_schema: schema({ learner: { type: 'string', description: 'A learner reference such as L-… from another tool.' } }, ['learner']) },
      run: async (client, actor, input) => {
        const id = await this.learnerOf(client, actor, input), today = await this.today(client);
        const term = await this.currentTerm(client, actor.schoolId).catch(() => null);
        const byTerm = await this.progress.learnerProgress(client, actor, id, 'term');
        const byWeek = await this.progress.learnerProgress(client, actor, id, 'week');
        const att = (await client.query(`SELECT count(*) FILTER (WHERE m.mark<>'unmarked' AND r.day>=$3)::int AS marked_term,count(*) FILTER (WHERE m.mark IN ('present','late') AND r.day>=$3)::int AS present_term,
            count(*) FILTER (WHERE m.mark='absent' AND r.day>=$4::date-30)::int AS absent_30,array_agg(r.day::text ORDER BY r.day) FILTER (WHERE m.mark='absent' AND r.day>=$4::date-30) AS absent_days
          FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id AND r.status IN ('submitted','locked')
          WHERE m.school_id=$1 AND m.learner_id=$2`, [actor.schoolId, id, term?.start_date ?? today, today])).rows[0];
        const enrolment = (await client.query(`SELECT c.id,c.name FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id WHERE e.school_id=$1 AND e.learner_id=$2 AND e.superseded_at IS NULL
          AND e.start_date<=$3 AND (e.end_date IS NULL OR e.end_date>$3) ORDER BY e.start_date DESC LIMIT 1`, [actor.schoolId, id, today])).rows[0];
        const plans = enrolment ? (await this.support.list(client, actor, { classId: enrolment.id, status: 'all' })).items.filter(p => p.learners.some((l: { id: string }) => l.id === id))
          .map(p => ({ subject: p.subject_name, topic: p.indicator_description, started: p.start_date, closed: p.closed, reviewDue: p.due, evidence: p.evidence })) : [];
        let mock: unknown = null;
        if (enrolment) try { const m = await this.mocks.rounds(client, actor, enrolment.id); const row = m.learners.find(l => l.learnerId === id);
          if (row?.latest) mock = { round: m.rounds.find(r => r.key === row.latest!.key)?.title, average: row.latest.average, change: row.latest.change, subjectsBelowPassLine: row.latest.below, needsSupport: row.latest.atRisk }; } catch { mock = null; }
        let fees: unknown = undefined;
        if (actor.role === 'headteacher' && term) {
          const inv = (await this.finance.invoices(client, actor.schoolId, { termId: term.id, search: '', limit: 200, offset: 0 } as never)).items.filter((i: { learner_id: string }) => i.learner_id === id);
          fees = inv.length ? { term: term.name, billedCedis: cedis(inv[0].due_pesewas), paidCedis: cedis(inv[0].paid_pesewas), balanceCedis: cedis(inv[0].balance_pesewas) } : { term: term.name, invoice: 'none' };
        }
        const recentWeeks = byWeek.buckets.slice(-6).map(b => b.key);
        return { learnerRef: learnerRef(id), class: enrolment?.name ?? 'not currently enrolled',
          subjectsByTerm: byTerm.subjects.map(s => ({ subject: s.name, terms: s.points.map((p, i) => ({ term: byTerm.buckets[i]!.label, classWorkAverage: p.assessmentAverage, reportTotal: p.termResult })).filter(p => p.classWorkAverage !== null || p.reportTotal !== null) })),
          recentWeeks: byWeek.subjects.map(s => ({ subject: s.name, weeks: s.points.filter(p => recentWeeks.includes(p.key) && p.assessmentAverage !== null).map(p => ({ from: p.key, average: p.assessmentAverage })) })).filter(s => s.weeks.length),
          attendance: { thisTermRate: pct(att.present_term, att.marked_term), daysMarkedThisTerm: att.marked_term, absencesLast30Days: att.absent_30, absentDaysLast30: att.absent_days ?? [] },
          supportPlans: plans, latestMock: mock, fees };
      },
    },

    support_plans: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'support_plans', description: 'Support plans (targeted help for named learners on a subject or topic, with review dates and whether marks since the start show improvement). Filter by class and status. Shows which reviews are due.',
        input_schema: schema({ class: { ...classProp, description: 'Optional class id or name.' }, status: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default open.' } }) },
      run: async (client, actor, input) => {
        const classId = input.class ? (await this.classOf(client, actor, input)).id : undefined;
        const r = await this.support.list(client, actor, { classId, status: choice(input, 'status', ['open', 'closed', 'all'] as const, 'open') });
        return { today: r.today, plans: r.items.slice(0, 30).map(p => ({ class: p.class_name, subject: p.subject_name, topic: p.indicator_description, learners: p.learners.map((l: { id: string }) => learnerRef(l.id)),
          started: p.start_date, closed: p.closed, reviewDue: p.due, evidence: p.evidence })), total: r.items.length };
      },
    },

    mock_results: {
      roles: ['headteacher', 'teacher'],
      def: { name: 'mock_results', description: 'BECE-style mock exam rounds for a class (kept apart from class work): average per round and per subject in the latest round, how many learners need support (2+ subjects below 50% in the latest mock), and those learners with their change from the previous round. This is a school prompt, not a BECE grade prediction.',
        input_schema: schema({ class: classProp }, ['class']) },
      run: async (client, actor, input) => {
        const section = await this.classOf(client, actor, input), m = await this.mocks.rounds(client, actor, section.id);
        const last = m.rounds[m.rounds.length - 1];
        const perSubject = last ? last.subjects.map(s => { const vals = m.learners.map(l => l.rounds.find(r => r.key === last.key)?.subjects.find(x => x.subjectId === s.subjectId)?.percent).filter((v): v is number => v !== null && v !== undefined);
          return { subject: s.name, average: mean(vals), belowPassLine: vals.filter(v => v < PASS_LINE).length, sat: vals.length }; }) : [];
        return { class: section, rounds: m.rounds.map(r => ({ title: r.title, heldOn: r.heldOn, ...m.summary.find(s => s.key === r.key) })), latestRoundBySubject: perSubject,
          needSupport: m.learners.filter(l => l.latest?.atRisk).map(l => ({ learnerRef: learnerRef(l.learnerId), average: l.latest!.average, change: l.latest!.change, subjectsBelowPassLine: l.latest!.below })),
          rule: `Needs support = ${m.riskSubjects}+ subjects below ${m.passLine}% in the latest mock.` };
      },
    },

    fees_summary: {
      roles: ['headteacher'],
      def: { name: 'fees_summary', description: 'Headteacher only. Fees for a term in Ghana cedis: billed, collected, outstanding and collection rate for the school and per class, and the largest outstanding balances.',
        input_schema: schema({ term_id: termProp }) },
      run: async (client, actor, input) => {
        const term = await this.term(client, actor.schoolId, input);
        const s = await this.finance.summary(client, actor.schoolId, term.id);
        const items: { learner_id: string; class_name: string; due_pesewas: number; paid_pesewas: number; balance_pesewas: number }[] = [];
        for (let offset = 0; ; offset += 200) { const page = await this.finance.invoices(client, actor.schoolId, { termId: term.id, search: '', limit: 200, offset } as never); items.push(...page.items); if (offset + 200 >= page.total || offset >= 5000) break; }
        const classes = [...new Set(items.map(i => i.class_name))].sort().map(name => { const own = items.filter(i => i.class_name === name), due = own.reduce((t, i) => t + i.due_pesewas, 0), paid = own.reduce((t, i) => t + i.paid_pesewas, 0);
          return { class: name, invoices: own.length, billedCedis: cedis(due), collectedCedis: cedis(paid), outstandingCedis: cedis(due - paid), collectionRate: pct(paid, due), unpaidInFull: own.filter(i => i.balance_pesewas > 0).length }; });
        return { term: { id: term.id, name: term.name }, invoices: s.invoices, billedCedis: cedis(s.billedPesewas), collectedCedis: cedis(s.collectedPesewas), outstandingCedis: cedis(s.outstandingPesewas),
          collectionRate: pct(s.collectedPesewas, s.billedPesewas), classes, largestBalances: items.filter(i => i.balance_pesewas > 0).sort((a, b) => b.balance_pesewas - a.balance_pesewas).slice(0, 10)
            .map(i => ({ learnerRef: learnerRef(i.learner_id), class: i.class_name, balanceCedis: cedis(i.balance_pesewas) })) };
      },
    },
  };

  definitions(role: string): Anthropic.Tool[] { return Object.values(this.tools).filter(t => t.roles.includes(role)).map(t => t.def); }
  async run(client: PoolClient, actor: Actor, name: string, input: Input) {
    const tool = this.tools[name];
    if (!tool) throw new BadRequestException(`Unknown tool ${name}`);
    if (!tool.roles.includes(actor.role)) throw new ForbiddenException('Your role cannot use this tool');
    return tool.run(client, actor, input ?? {});
  }
}
