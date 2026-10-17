import { NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

// One staff member's page for the headteacher: who they are, the classes they teach, what they have done lately and the
// history of their sign-in. Everything here is read from records the school already keeps; nothing is stored for the page.

type Meta = Record<string, unknown>;
const when = (day: unknown) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }) : '';
const count = (n: unknown, one: string, many = `${one}s`) => typeof n === 'number' ? `${n} ${n === 1 ? one : many}` : many;
// What each recorded action reads as on the page. Actions not listed here (drafts, saves, background work) are left out.
const doing: Record<string, (m: Meta, cls: string) => string> = {
  'attendance.register.submit': (m, cls) => `Submitted the register${cls ? ` for ${cls}` : ''}${m.day ? ` on ${when(m.day)}` : ''}`,
  'attendance.register.lock': (m, cls) => `Locked the register${cls ? ` for ${cls}` : ''}${m.day ? ` on ${when(m.day)}` : ''}`,
  'attendance.mark.corrected': (_m, cls) => `Corrected an attendance mark${cls ? ` in ${cls}` : ''}`,
  'assessment.class_assessment.created': (_m, cls) => `Set class work${cls ? ` for ${cls}` : ''}`,
  'assessment.class_assessment.marked': (m, cls) => `Marked class work${cls ? ` for ${cls}` : ''}${typeof m.written === 'number' ? ` (${count(m.written, 'mark')})` : ''}`,
  'assessment.scores.recorded': (m) => `Recorded ${count(m.written, 'exam score')}`,
  'assessment.remarks.recorded': (m) => `Wrote ${count(m.written, 'report card remark')}`,
  'assessment.reports.published': (m) => `Published ${count(m.published, 'report card')}`,
  'assessment.support_plan.created': (_m, cls) => `Started a support plan${cls ? ` in ${cls}` : ''}`,
  'assessment.support_plan.reviewed': () => 'Reviewed a support plan',
  'learner.note.added': () => 'Added a note about a student',
  'learning.note.written': () => 'Wrote a learning note for a student',
  'learning.topics.approved': () => 'Approved topics for a class level',
  'learning.generated': () => 'Made lessons and questions from the school\'s topics',
  'practice.set.approved': () => 'Approved a set of practice questions',
  'early-years.observation.created': (m) => `Recorded an early years observation${m.observedOn ? ` for ${when(m.observedOn)}` : ''}`,
  'early-years.report.submitted': () => 'Sent an early years report for approval',
  'early-years.report.approved': () => 'Approved an early years report',
  'early-years.report.published': () => 'Published an early years report',
  'admission.created': () => 'Recorded a new application',
  'admission.review': () => 'Started reviewing an application',
  'admission.offered': () => 'Offered a place',
  'admission.waitlisted': () => 'Put an application on the waitlist',
  'admission.declined': () => 'Declined an application',
  'admission.accepted': () => 'Recorded that a family accepted a place',
  'admission.enrolled': () => 'Enrolled a student',
  'admission_note.added': () => 'Added a note to an application',
  'guardian.link.pending': () => 'Linked a parent to a student',
  'guardian.link.verified': () => 'Verified a parent\'s link to a student',
  'collection.released': () => 'Released a student to a parent at pick-up',
  'finance.payment.recorded': (m) => `Recorded a payment${typeof m.receiptNumber === 'number' ? ` (receipt ${m.receiptNumber})` : ''}`,
  'finance.payment.reversed': () => 'Reversed a payment',
  'finance.invoices.generated': (m) => `Created bills for ${count(m.created, 'student')}`,
  'finance.fee-item.created': () => 'Added a fee item',
  'notice.created': () => 'Wrote a notice',
  'notice.approved': () => 'Approved a notice to send',
  'teaching.assignment.created': (_m, cls) => `Assigned a teacher${cls ? ` to ${cls}` : ''}`,
  'teaching.assignment.revoked': () => 'Ended a teacher\'s class assignment',
  'class.created': () => 'Created a class',
  'account.created': () => 'Created a sign-in',
  'account.password_reset': () => 'Reset a password',
  'account.phone_set': () => 'Changed a phone number',
  'account.revoked': () => 'Removed someone\'s access',
  'learner.corrected': () => 'Corrected a student\'s details',
  'learner.transferred': () => 'Moved a student to another class',
  'learner.withdrawn': () => 'Withdrew a student',
  'learners.promotion.completed': () => 'Completed year-end promotion',
};
const known = Object.keys(doing);
// Counts for the 30-day tiles, chosen for what each role does.
const tiles: Record<string, { label: string; actions: string[] }[]> = {
  teacher: [
    { label: 'Registers submitted', actions: ['attendance.register.submit'] },
    { label: 'Class work set', actions: ['assessment.class_assessment.created'] },
    { label: 'Class work marked', actions: ['assessment.class_assessment.marked'] },
    { label: 'Notes written', actions: ['learner.note.added', 'learning.note.written'] },
  ],
  frontdesk: [
    { label: 'Applications recorded', actions: ['admission.created'] },
    { label: 'Decisions taken', actions: ['admission.review', 'admission.offered', 'admission.waitlisted', 'admission.declined', 'admission.accepted', 'admission.enrolled'] },
    { label: 'Pick-ups released', actions: ['collection.released'] },
    { label: 'Parents linked', actions: ['guardian.link.pending'] },
  ],
  accountant: [
    { label: 'Payments recorded', actions: ['finance.payment.recorded'] },
    { label: 'Payments reversed', actions: ['finance.payment.reversed'] },
    { label: 'Bills created', actions: ['finance.invoices.generated'] },
    { label: 'Fee items added', actions: ['finance.fee-item.created'] },
  ],
  headteacher: [
    { label: 'Registers locked', actions: ['attendance.register.lock'] },
    { label: 'Report cards published', actions: ['assessment.reports.published'] },
    { label: 'Application decisions', actions: ['admission.offered', 'admission.waitlisted', 'admission.declined', 'admission.enrolled'] },
    { label: 'Accounts managed', actions: ['account.created', 'account.password_reset', 'account.revoked'] },
  ],
};

async function classNames(client: PoolClient, schoolId: string, rows: { metadata: Meta }[]) {
  const ids = [...new Set(rows.map(r => r.metadata?.classId).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)))];
  if (!ids.length) return new Map<string, string>();
  return new Map((await client.query('SELECT id,name FROM class_sections WHERE school_id=$1 AND id=ANY($2::uuid[])', [schoolId, ids])).rows.map(r => [r.id as string, r.name as string]));
}
const describe = (row: { action: string; metadata: Meta }, names: Map<string, string>) => (doing[row.action] ?? (() => row.action))(row.metadata ?? {}, names.get(String(row.metadata?.classId)) ?? '');

export async function memberActivity(client: PoolClient, schoolId: string, membershipId: string, offset: number, limit: number) {
  const from = 'FROM audit_events WHERE school_id=$1 AND actor_membership_id=$2 AND action=ANY($3::text[])';
  const total = Number((await client.query(`SELECT count(*) ${from}`, [schoolId, membershipId, known])).rows[0].count);
  const rows = (await client.query(`SELECT id,action,created_at,metadata ${from} ORDER BY created_at DESC,id LIMIT $4 OFFSET $5`, [schoolId, membershipId, known, limit, offset])).rows;
  const names = await classNames(client, schoolId, rows);
  return { items: rows.map(r => ({ id: r.id as string, at: r.created_at as string, text: describe(r, names) })), total, offset, limit };
}

export async function memberProfile(client: PoolClient, schoolId: string, membershipId: string) {
  const member = (await client.query('SELECT user_id,membership_id,display_name,login,role,revoked_at,must_change_password,phone FROM staff_list() WHERE membership_id=$1', [membershipId])).rows[0];
  if (!member || member.role === 'guardian') throw new NotFoundException('Staff member unavailable');
  const today = (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS d")).rows[0].d as string;

  const assignments = (await client.query(`SELECT t.id,t.class_id,c.name AS class_name,c.level,y.name AS year_name,t.start_date::text,t.end_date::text,t.grant_reason,t.revoked_at,t.revocation_reason,
      (SELECT count(*)::int FROM enrolments e WHERE e.school_id=t.school_id AND e.class_id=t.class_id AND e.superseded_at IS NULL AND e.start_date<=$3::date AND (e.end_date IS NULL OR e.end_date>$3::date)) AS students
    FROM teaching_assignments t JOIN class_sections c ON c.school_id=t.school_id AND c.id=t.class_id JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id
    WHERE t.school_id=$1 AND t.teacher_membership_id=$2 ORDER BY t.end_date DESC,c.name,t.id`, [schoolId, membershipId, today])).rows
    .map(a => ({ ...a, status: a.revoked_at ? 'ended' : a.start_date > today ? 'upcoming' : a.end_date <= today ? 'finished' : 'current' as string }));
  const current = assignments.filter(a => a.status === 'current');
  const students = current.length ? Number((await client.query(`SELECT count(DISTINCT e.learner_id) FROM enrolments e WHERE e.school_id=$1 AND e.class_id=ANY($2::uuid[]) AND e.superseded_at IS NULL
      AND e.start_date<=$3::date AND (e.end_date IS NULL OR e.end_date>$3::date)`, [schoolId, current.map(a => a.class_id), today])).rows[0].count) : 0;

  const counts = new Map((await client.query("SELECT action,count(*)::int AS n FROM audit_events WHERE school_id=$1 AND actor_membership_id=$2 AND created_at>=now()-interval '30 days' GROUP BY action", [schoolId, membershipId])).rows.map(r => [r.action as string, r.n as number]));
  const highlights = (tiles[member.role] ?? []).map(t => ({ label: t.label, value: t.actions.reduce((n, a) => n + (counts.get(a) ?? 0), 0) }));
  const money = member.role === 'accountant'
    ? Number((await client.query("SELECT coalesce(sum(amount_pesewas),0) AS total FROM payments WHERE school_id=$1 AND recorded_by=$2 AND recorded_at>=now()-interval '30 days'", [schoolId, membershipId])).rows[0].total) : null;

  // The sign-in's own history: who created it, resets, phone changes and removal, newest first.
  const names = new Map((await client.query('SELECT membership_id,display_name FROM staff_list()')).rows.map(r => [r.membership_id as string, r.display_name as string]));
  const account = (await client.query(`SELECT action,created_at,actor_membership_id FROM audit_events WHERE school_id=$1 AND target_id=$2 AND action IN ('account.created','account.password_reset','account.phone_set','account.revoked') ORDER BY created_at DESC,id LIMIT 20`, [schoolId, member.user_id])).rows
    .map(e => ({ at: e.created_at as string, by: names.get(e.actor_membership_id) ?? null, text: ({ 'account.created': 'Sign-in created', 'account.password_reset': 'Temporary password reset', 'account.phone_set': 'Phone number changed', 'account.revoked': 'Access removed' } as Record<string, string>)[e.action]! }));

  return {
    today,
    member: { userId: member.user_id as string, membershipId: member.membership_id as string, name: member.display_name as string, login: member.login as string, role: member.role as string, phone: member.phone as string | null, revokedAt: member.revoked_at as string | null, mustChangePassword: member.must_change_password as boolean },
    classes: assignments.map(a => ({ id: a.id as string, classId: a.class_id as string, className: a.class_name as string, level: a.level as string, yearName: a.year_name as string, startDate: a.start_date as string, endDate: a.end_date as string,
      status: a.status, students: a.students as number, reason: a.grant_reason as string, endedReason: a.revocation_reason as string | null })),
    summary: { classes: current.length, students, highlights, moneyPesewas: money },
    account,
    activity: await memberActivity(client, schoolId, membershipId, 0, 8),
  };
}
