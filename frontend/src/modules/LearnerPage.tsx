import React, { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Icon, PageHeader, Pill, Stat, Tabs, Tone, when } from '../lib/ui';
import { ProfileCard, QuickAction, QuickActions, SummaryCard } from '../lib/profile';
import { SchoolLogo } from '../lib/logo';
import { localPhone } from '../lib/dates';
import { Step, stepNames } from '../lib/admissions';
import { findOn } from '../lib/find';
import { caPartLabels } from '../lib/caParts';
import { LearningNotes } from './LearningNotes';
import { Note, NotesCard } from './LearnerNotes';
import { SupportPlanDialog } from './Support';
import { LearnerHomePractice } from './HomePracticeStaff';

type PartKey = typeof caPartLabels[number][0];
type SubjectTerm = { subjectId: string; name: string; parts: Record<PartKey, { average: number | null; marked: number; set: number }>; classWork: number | null; marks: number; lastMarked: string | null;
  ca: number | null; recordedCa: number | null; exam: number | null; total: number | null; gap: { direction: 'exam_higher' | 'exam_lower'; difference: number } | null;
  attention: { reason: 'dropping' | 'below_pass'; recent: number; earlier: number | null } | null };
type Profile = {
  today: string;
  learner: { id: string; fullName: string; admissionNumber: string; dateOfBirth: string | null; sex: 'female' | 'male' | null };
  currentClass: { id: string; name: string; level: string | null; since: string } | null;
  enrolments: { classId: string; className: string; startDate: string; endDate: string | null; endReason: string | null }[];
  guardians: { name: string; verified: boolean; rights: string[]; phone?: string | null }[];
  terms: { id: string; name: string; yearName: string }[]; term: { id: string; name: string; yearName: string; startDate: string; endDate: string } | null;
  attendance: { marked: number; present: number; late: number; absent: number; excused: number; rate: number | null; absentDays: string[]; days: { day: string; mark: string }[] } | null;
  classTeachers: string[]; application: { id: string; receivedOn: string; startDate: string } | null;
  termWork: { policy: { caWeight: number; examWeight: number; parts: Record<PartKey, number> } | null; subjects: SubjectTerm[] } | null;
  history: { buckets: { key: string; label: string }[]; subjects: { subjectId: string; name: string; points: { key: string; assessmentAverage: number | null; termResult: number | null }[] }[] };
  reports: { term_id: string; term_name: string; year_name: string; class_name: string; average: number | null; position: number | null; class_size: number | null; revision: number; teacher_remark: string | null }[];
  plans: { id: string; className: string; subject: string; topic: string | null; concern: string; action: string; owner: string; startDate: string; closed: boolean; due: boolean; nextReview: string | null }[];
  mock: { round: string | null; average: number | null; change: number | null; below: { name: string; percent: number }[] | string[]; needsSupport: boolean } | null;
  fees?: { id: string; term_name: string; year_name: string; total_pesewas: number; paid_pesewas: number; balance_pesewas: number }[];
  notes: Note[];
};

const tone = (n: number | null): Tone => n === null ? 'neutral' : n >= 70 ? 'positive' : n >= 50 ? 'caution' : 'critical';
const Pct = ({ value, sub }: { value: number | null; sub?: string }) => <>{value === null ? <span className="muted">–</span> : <strong className={`tone-${tone(value)}`}>{value}</strong>}{sub && <span className="sub">{sub}</span>}</>;
const date = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const cedis = (pesewas: number) => `GH₵ ${(pesewas / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function ageOn(dob: string, today: string) { const [y, m, d] = dob.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number); return ty! - y! - (tm! < m! || (tm === m && td! < d!) ? 1 : 0); }
const rightLabel: Record<string, string> = { academic: 'reports', billing: 'fees', pickup: 'pickup', contact: 'contact' };
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const markText: Record<string, [string, Tone]> = { present: ['Present', 'neutral'], late: ['Late', 'caution'], absent: ['Absent', 'critical'], excused: ['Excused', 'info'] };
type TabId = 'overview' | 'academics' | 'attendance' | 'notes' | 'fees' | 'history';


// "Dropping 60% → 44%", "Exam 22 pts below class work", "2 pieces of work without a mark": what is worth a look in one subject.
function Flags({ s }: { s: SubjectTerm }) {
  const missed = caPartLabels.reduce((n, [key]) => n + Math.max(0, s.parts[key].set - s.parts[key].marked), 0);
  return <>{s.attention && <Pill tone={s.attention.reason === 'dropping' ? 'critical' : 'caution'}>{s.attention.reason === 'dropping' ? `Dropping ${s.attention.earlier}% → ${s.attention.recent}%` : `Recent marks ${s.attention.recent}%`}</Pill>}
    {s.gap && <Pill tone={s.gap.direction === 'exam_higher' ? 'caution' : 'info'}>{`Exam ${Math.round(Math.abs(s.gap.difference))} pts ${s.gap.direction === 'exam_higher' ? 'above' : 'below'} class work`}</Pill>}
    {missed > 0 && <Pill tone="neutral">{missed} piece{missed === 1 ? '' : 's'} of work without a mark</Pill>}</>;
}

// One student on one page: who they are in a card, a summary and quick actions down the side, and tabs for how they are doing
// (subject by subject, term by term, report cards, support plans), attendance, notes and home practice, fees and history.
export function LearnerPage({ schoolId, csrfToken, role, learnerId }: { schoolId: string; csrfToken: string; role: string; learnerId: string }) {
  const [termId, setTermId] = useState(''); const [data, setData] = useState<Profile | null>(null); const [error, setError] = useState('');
  const [planFor, setPlanFor] = useState(''); const [message, setMessage] = useState(''); const [tab, setTab] = useState<TabId>('overview');
  const [school, setSchool] = useState<{ name: string; motto?: string | null; address?: string | null; phone?: string | null } | null>(null);
  const [decisions, setDecisions] = useState<{ step: Step; at: string; by: string | null; reason: string | null }[] | null>(null);
  const load = useCallback(async () => {
    try { setData(await request<Profile>(`/schools/${schoolId}/learners/${learnerId}/profile${termId ? `?termId=${termId}` : ''}`)); setError(''); } catch (e) { setError((e as Error).message); }
  }, [schoolId, learnerId, termId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  // The school's heading for the printed record.
  useEffect(() => { void request<NonNullable<typeof school>>(`/schools/${schoolId}`).then(setSchool).catch(() => undefined); }, [schoolId]);
  // The application's decisions, read once the History tab is opened (the head and front desk can read applications).
  const applicationId = data?.application?.id;
  useEffect(() => {
    if (tab !== 'history' || !applicationId || decisions) return;
    void request<{ timeline: NonNullable<typeof decisions> }>(`/schools/${schoolId}/admissions/${applicationId}`).then(r => setDecisions(r.timeline)).catch(() => setDecisions([]));
  }, [tab, applicationId, decisions, schoolId]);
  const back = () => history.length > 1 ? history.back() : (location.hash = role === 'headteacher' ? '#/students' : '#/progress');
  if (error && !data) return <section className="page"><PageHeader eyebrow="Student" title="Student unavailable" blurb={error} actions={<button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>}/></section>;
  if (!data) return <p role="status">Loading…</p>;

  const head = role === 'headteacher';
  const { learner: l, termWork: tw, attendance: att } = data;
  const subjects = tw?.subjects ?? [];
  const withWork = subjects.filter(s => s.classWork !== null);
  const overall = withWork.length ? Math.round(withWork.reduce((n, s) => n + s.classWork!, 0) / withWork.length * 10) / 10 : null;
  const gaps = subjects.filter(s => s.gap), lookAt = subjects.filter(s => s.attention || s.gap);
  const parts = caPartLabels.filter(([key]) => (tw?.policy?.parts[key] ?? 0) > 0 || subjects.some(s => s.parts[key].set));
  const openPlans = data.plans.filter(p => !p.closed);
  // Plans are started in the learner's current class for the current term.
  const canPlan = !!data.currentClass && !!data.term && data.term.startDate <= data.today && data.term.endDate >= data.today;
  const hasOpenPlan = (subject: string) => openPlans.some(p => p.subject === subject);
  const planSubject = canPlan ? lookAt.find(s => !hasOpenPlan(s.name)) : undefined;
  const age = l.dateOfBirth ? ageOn(l.dateOfBirth, data.today) : null, sexText = l.sex === 'female' ? 'Girl' : l.sex === 'male' ? 'Boy' : null;
  const first = data.enrolments[data.enrolments.length - 1] ?? null, parent = data.guardians[0];
  const owing = data.fees ? data.fees.reduce((n, f) => n + f.balance_pesewas, 0) : null;
  // "Basic 5 · Primary" says something; "JHS 1 · JHS" does not.
  const classText = data.currentClass ? `${data.currentClass.name}${data.currentClass.level && !data.currentClass.name.toLowerCase().startsWith(data.currentClass.level.toLowerCase()) ? ` · ${data.currentClass.level}` : ''}` : 'Not currently enrolled';
  const teachers = data.classTeachers.join(', ') || 'Not assigned yet';

  const parentList = !data.guardians.length ? <p className="muted">No parent linked yet.{head ? ' Link one on the Parents page.' : ''}</p>
    : <ul className="plain-list">{data.guardians.map((g, i) => <li key={i}><strong>{g.name}</strong>{!g.verified && <> <Pill tone="caution">not verified</Pill></>}
      <span className="sub">May see: {g.rights.map(r => rightLabel[r] ?? r).join(', ') || 'nothing yet'}</span>{g.phone && <a className="sub" href={`tel:${g.phone}`}>{localPhone(g.phone)}</a>}</li>)}</ul>;
  const supportPlans = <Card title="Support plans">
    {!data.plans.length ? <p className="muted">No support plans.</p>
      : <ul className="plain-list">{data.plans.map(p => <li key={p.id}><strong>{p.subject}{p.topic ? `: ${p.topic}` : ''}</strong> <Pill tone={p.closed ? 'neutral' : p.due ? 'caution' : 'info'}>{p.closed ? 'Closed' : p.due ? 'Review due' : 'Open'}</Pill>
        <span className="sub">{p.action} · {p.owner} · since {shortDate(p.startDate)}{!p.closed && p.nextReview ? ` · review ${shortDate(p.nextReview)}` : ''}</span></li>)}</ul>}
  </Card>;
  const reportCards = <Card title="Report cards">
    {!data.reports.length ? <p className="muted">No published report cards yet.</p>
      : <ul className="plain-list">{data.reports.map(r => <li key={r.term_id}><strong>{r.term_name} · {r.year_name}</strong><span className="sub">{r.class_name} · average {r.average ?? '–'}{r.position ? ` · position ${r.position} of ${r.class_size}` : ''}{r.revision > 1 ? ` · corrected (revision ${r.revision})` : ''}</span>
        {r.teacher_remark && <span className="sub">“{r.teacher_remark}”</span>}</li>)}</ul>}
  </Card>;

  const actions: QuickAction[] = [
    { icon: 'edit_note', label: 'Add a note', onClick: () => setTab('notes') },
    ...(planSubject ? [{ icon: 'volunteer_activism', label: `Plan support in ${planSubject.name}`, onClick: () => { setMessage(''); setPlanFor(planSubject.subjectId); } }] : []),
    { icon: 'print', label: 'Print student record', onClick: () => window.print() },
    ...(head && data.application ? [{ icon: 'assignment_ind', label: 'Open the application', href: `#/admission/${data.application.id}` }] : []),
    ...(head ? [{ icon: 'family_restroom', label: 'Parents', href: '#/parents' }, { icon: 'receipt_long', label: 'Fees in Accounts', onClick: () => { findOn({ page: 'accounts', text: l.admissionNumber }); location.hash = '#/accounts'; } }] : []),
  ];
  const tabs: { id: TabId; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'academics', label: 'Academics' }, { id: 'attendance', label: 'Attendance' }, { id: 'notes', label: 'Notes & practice' },
    ...(data.fees ? [{ id: 'fees' as const, label: 'Fees' }] : []), { id: 'history', label: 'History' }];

  // The subject table and the notes forms need the full width, so those two tabs go without the side rail.
  const wide = tab === 'academics' || tab === 'notes';
  return <section className="page learner-page" aria-label={`Student ${l.fullName}`}>
    <PageHeader eyebrow="Student" title="Student details" blurb={`${l.admissionNumber} · ${classText}`}
      actions={<><button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>
        {data.terms.length > 0 && <label className="inline-field">Term<select value={data.term?.id ?? ''} onChange={e => setTermId(e.target.value)}>{data.terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.yearName}</option>)}</select></label>}</>}/>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <ProfileCard name={l.fullName} kind={[sexText, age !== null ? `${age} years` : null, l.dateOfBirth ? `born ${date(l.dateOfBirth)}` : null].filter(Boolean).join(' · ') || 'Student'}
      pills={<>{data.currentClass ? <Pill tone="positive">Enrolled</Pill> : <Pill tone="neutral">Not currently enrolled</Pill>}{lookAt.length > 0 && <Pill tone="caution">{lookAt.length} worth a look</Pill>}
        {openPlans.some(p => p.due) && <Pill tone="caution">Support plan review due</Pill>}{owing !== null && owing > 0 && <Pill tone="critical">Owes {cedis(owing)}</Pill>}</>}
      facts={[{ label: 'Admission number', value: l.admissionNumber }, { label: 'Class', value: classText }, { label: data.classTeachers.length > 1 ? 'Teachers' : 'Teacher', value: teachers },
        { label: 'Enrolled since', value: first ? date(first.startDate) : '–' }]}/>
    <div className={wide ? 'profile-layout wide' : 'profile-layout'}>
      <div className="profile-main">
        <div className="profile-tabs"><Tabs label="Student" value={tab} onChange={setTab} options={tabs}/></div>

        {tab === 'overview' && <>
          <div className="stats">
            <Stat label="Attendance" value={att?.rate !== null && att?.rate !== undefined ? `${att.rate}%` : '–'} caption={att?.marked ? `${att.absent} absent, ${att.late} late of ${att.marked} days` : 'No registers yet this term'} icon="event_available" tone={att?.rate == null ? 'neutral' : att.rate >= 90 ? 'positive' : att.rate >= 80 ? 'caution' : 'critical'}/>
            <Stat label="Class work average" value={overall === null ? '–' : `${overall}%`} caption={withWork.length ? `${withWork.length} subject${withWork.length === 1 ? '' : 's'} this term` : 'No marks yet this term'} icon="insights" tone={tone(overall)}/>
            <Stat label="Worth a look" value={lookAt.length} caption={lookAt.length ? lookAt.map(s => s.name).join(', ') : 'Nothing flagged this term'} icon="flag" tone={lookAt.length ? 'caution' : 'neutral'}/>
            <Stat label="Support plans" value={openPlans.length} caption={openPlans.some(p => p.due) ? 'A review is due' : openPlans.length ? 'Open' : 'None open'} icon="volunteer_activism" tone={openPlans.some(p => p.due) ? 'caution' : 'neutral'}/>
          </div>
          <div className="cards-2">
            <Card title="Student information">
              <dl className="facts-grid">
                <div><dt>Full name</dt><dd>{l.fullName}</dd></div>
                <div><dt>Date of birth</dt><dd>{l.dateOfBirth ? `${date(l.dateOfBirth)} (${age} years)` : 'Not recorded'}</dd></div>
                <div><dt>Sex</dt><dd>{sexText ?? 'Not recorded'}</dd></div>
                <div><dt>Admission number</dt><dd>{l.admissionNumber}</dd></div>
                <div><dt>Class</dt><dd>{classText}</dd></div>
                <div><dt>Enrolled since</dt><dd>{first ? date(first.startDate) : '–'}</dd></div>
                {data.term && <div><dt>Academic year</dt><dd>{data.term.yearName}</dd></div>}
                <div><dt>Class history</dt><dd>{data.enrolments.length} class{data.enrolments.length === 1 ? '' : 'es'}</dd></div>
              </dl>
            </Card>
            <Card title="Parents and guardians">{parentList}</Card>
          </div>
          <Card title="Worth a look this term" hint="Marks that are dropping or low, or an exam far from class work.">
            {!lookAt.length ? <p className="muted">Nothing flagged this term.</p>
              : <ul className="plain-list">{lookAt.map(s => <li key={s.subjectId}><strong>{s.name}</strong> <span className="pill-row"><Flags s={s}/>
                {hasOpenPlan(s.name) && <Pill tone="info">Plan open</Pill>}</span></li>)}</ul>}
          </Card>
        </>}

        {tab === 'academics' && <>
          <Card title={data.term ? `${data.term.name} · ${data.term.yearName}, subject by subject` : 'This term'} hint={tw?.policy ? `CA ${tw.policy.caWeight}% and exam ${tw.policy.examWeight}%. The CA comes from class work, weighted as the school sets it.` : undefined} flush>
            {!subjects.length ? <Empty title="Nothing recorded this term yet" hint="Class work, CA and exam scores appear here as teachers enter them."/>
              : <div className="table-wrap"><table className="ca-sheet"><thead><tr><th>Subject</th>{parts.map(([key, label]) => <th key={key} className="num">{label}</th>)}
                  <th className="num">CA</th><th className="num">Exam</th><th className="num">Total</th><th>Worth a look</th></tr></thead><tbody>
                {subjects.map(s => <tr key={s.subjectId}><td>{s.name}{s.lastMarked && <span className="sub">Last mark {shortDate(s.lastMarked)}</span>}</td>
                  {parts.map(([key]) => <td key={key} className="num"><Pct value={s.parts[key].average} sub={s.parts[key].set ? `${s.parts[key].marked} of ${s.parts[key].set}` : undefined}/></td>)}
                  <td className="num"><Pct value={s.recordedCa ?? s.ca} sub={s.recordedCa === null ? (s.ca === null ? undefined : 'not saved') : undefined}/></td>
                  <td className="num"><Pct value={s.exam}/></td><td className="num"><Pct value={s.total}/></td>
                  <td><span className="pill-row"><Flags s={s}/>{!s.attention && !s.gap && <span className="muted">–</span>}
                    {canPlan && (s.attention || s.gap) && (hasOpenPlan(s.name) ? <Pill tone="info">Plan open</Pill> : <button type="button" className="secondary small" onClick={() => { setMessage(''); setPlanFor(s.subjectId); }}>Plan</button>)}</span></td></tr>)}</tbody></table></div>}
            {gaps.length > 0 && <p className="muted card-body">An exam 20 or more points away from class work is worth a quiet conversation, for example about a bad exam day, missed class work, or work done with help. It is not proof of anything.</p>}
          </Card>
          <div className="cards-2">{supportPlans}{reportCards}</div>
          {data.mock && <Card title="Latest mock exam">
            <p><strong className={`tone-${tone(data.mock.average)}`}>{data.mock.average ?? '–'}%</strong> {data.mock.round}{data.mock.change !== null && <span className="muted"> ({data.mock.change > 0 ? '+' : ''}{data.mock.change} on the round before)</span>}</p>
            {data.mock.needsSupport && <Pill tone="caution">Needs support in two or more subjects</Pill>}</Card>}
          <Card title="Term by term" hint="Term result (CA and exam) where recorded; otherwise the class work average for that term." flush>
            {!data.history.buckets.length ? <Empty title="No earlier terms yet"/>
              : <div className="table-wrap"><table className="trend-table"><thead><tr><th>Subject</th>{data.history.buckets.map(b => <th key={b.key}>{b.label}</th>)}</tr></thead><tbody>
                {data.history.subjects.map(s => <tr key={s.subjectId}><td>{s.name}</td>{s.points.map(p => <td key={p.key} className="num"><Pct value={p.termResult ?? p.assessmentAverage} sub={p.termResult !== null ? 'term result' : p.assessmentAverage !== null ? 'class work' : undefined}/></td>)}</tr>)}</tbody></table></div>}
          </Card>
        </>}

        {tab === 'attendance' && (!att?.marked
          ? <Card title="Attendance this term"><Empty title="No registers recorded for this term yet" hint="Each day's mark appears here once the class register is submitted."/></Card>
          : <>
            <div className="stats">
              <Stat label="Present" value={att.rate !== null ? `${att.rate}%` : '–'} caption={`${att.present} of ${att.marked} days (${att.late} late)`} icon="event_available" tone={att.rate === null ? 'neutral' : att.rate >= 90 ? 'positive' : att.rate >= 80 ? 'caution' : 'critical'}/>
              <Stat label="Absent" value={att.absent} caption={att.absent === 1 ? 'day' : 'days'} icon="event_busy" tone={att.absent ? 'critical' : 'neutral'}/>
              <Stat label="Late" value={att.late} caption={att.late === 1 ? 'day' : 'days'} icon="schedule" tone={att.late ? 'caution' : 'neutral'}/>
              <Stat label="Excused" value={att.excused} caption={att.excused === 1 ? 'day' : 'days'} icon="event_note" tone="neutral"/>
            </div>
            <Card title="Recent days" hint={`${data.term?.name ?? 'This term'}, newest first. Each day is the class register's mark.`}>
              <div className="pill-row">{att.days.map(d => { const [text, mark] = markText[d.mark] ?? [d.mark, 'neutral' as Tone]; return <Pill key={d.day} tone={mark}>{dayName(d.day)} · {text}</Pill>; })}</div>
              {att.marked > att.days.length && <p className="muted">Showing the latest {att.days.length} of {att.marked} days.</p>}
            </Card>
          </>)}

        {tab === 'notes' && <div className="columns">
          <div className="stack">
            <NotesCard schoolId={schoolId} csrfToken={csrfToken} learnerId={l.id} notes={data.notes} onChanged={() => void load()}/>
            <LearningNotes key={`learning-notes:${l.id}`} schoolId={schoolId} csrfToken={csrfToken} learnerId={l.id}/>
          </div>
          <div className="stack"><LearnerHomePractice key={`practice:${l.id}`} schoolId={schoolId} learnerId={l.id}/></div>
        </div>}

        {tab === 'fees' && data.fees && <>
          <div className="stats">
            <Stat label="Billed" value={cedis(data.fees.reduce((n, f) => n + f.total_pesewas, 0))} caption={`${data.fees.length} bill${data.fees.length === 1 ? '' : 's'}`} icon="receipt_long" tone="neutral"/>
            <Stat label="Paid" value={cedis(data.fees.reduce((n, f) => n + f.paid_pesewas, 0))} icon="payments" tone="positive"/>
            <Stat label="Owing" value={cedis(owing ?? 0)} caption={owing ? 'Still to pay' : 'Nothing owing'} icon="account_balance_wallet" tone={owing ? 'critical' : 'neutral'}/>
          </div>
          <Card title="Bills" action={<button type="button" className="secondary" onClick={() => { findOn({ page: 'accounts', text: l.admissionNumber }); location.hash = '#/accounts'; }}><Icon name="receipt_long"/>Open in Accounts</button>}>
            {!data.fees.length ? <p className="muted">No bills yet.</p>
              : <ul className="plain-list">{data.fees.map(f => <li key={f.id}><strong>{f.term_name} · {f.year_name}</strong><span className="sub">Billed {cedis(f.total_pesewas)} · paid {cedis(f.paid_pesewas)}{f.balance_pesewas > 0 ? ` · owing ${cedis(f.balance_pesewas)}` : ' · paid in full'}</span></li>)}</ul>}
          </Card>
        </>}

        {tab === 'history' && <div className="cards-2">
          <Card title="Classes" hint="Every class this student has been in, newest first.">
            <ol className="timeline">{data.enrolments.map((e, i) => <li key={i}><strong>{e.className}</strong><span>From {date(e.startDate)}{e.endDate ? ` to ${date(e.endDate)}${e.endReason ? ` (${e.endReason})` : ''}` : ' · now'}</span></li>)}</ol>
          </Card>
          {head && <Card title="Application">
            {data.application ? <><dl className="facts-grid"><div><dt>Received</dt><dd>{date(data.application.receivedOn)}</dd></div><div><dt>Start date</dt><dd>{date(data.application.startDate)}</dd></div></dl>
              <p><a className="learner-link" href={`#/admission/${data.application.id}`}>Open the application</a></p></>
              : <p className="muted">Not admitted through an application here (added by import or directly).</p>}
          </Card>}
          {head && data.application && <Card title="Decisions on the application" hint="Every step, who took it and when.">
            {decisions === null ? <p role="status" className="muted">Loading…</p> : !decisions.length ? <p className="muted">No decisions recorded.</p>
              : <ol className="timeline">{decisions.map((d, i) => <li key={i}><strong>{stepNames[d.step] ?? d.step}</strong><span>{when(d.at)}{d.by ? ` · ${d.by}` : ''}</span>{d.reason && <span>Reason: {d.reason}</span>}</li>)}</ol>}
          </Card>}
        </div>}
      </div>

      {!wide && <aside className="profile-rail" aria-label="Summary and quick actions">
        <SummaryCard title="Summary" rows={[
          { icon: 'badge', label: 'Admission no.', value: l.admissionNumber },
          { icon: 'school', label: 'Class', value: classText },
          { icon: 'groups', label: data.classTeachers.length > 1 ? 'Teachers' : 'Teacher', value: teachers },
          { icon: 'calendar_month', label: 'Enrolled since', value: first ? date(first.startDate) : '–' },
          { icon: 'family_restroom', label: 'Parent', value: parent ? `${parent.name}${data.guardians.length > 1 ? ` +${data.guardians.length - 1}` : ''}` : 'None linked' },
          ...(parent?.phone ? [{ icon: 'call', label: 'Phone', value: <a href={`tel:${parent.phone}`}>{localPhone(parent.phone)}</a> }] : []),
          { icon: 'event_available', label: 'Attendance', value: att?.rate != null ? `${att.rate}%` : '–' },
          { icon: 'insights', label: 'Class work', value: overall === null ? '–' : `${overall}%` },
          ...(owing !== null ? [{ icon: 'account_balance_wallet', label: 'Fees owing', value: <span className={owing > 0 ? 'tone-critical' : undefined}>{owing > 0 ? cedis(owing) : 'None'}</span> }] : []),
        ]}/>
        <QuickActions actions={actions}/>
      </aside>}
    </div>

    <article className="receipt student-record">
      <header className="doc-head"><SchoolLogo schoolId={schoolId} className="doc-logo"/>
        <div className="doc-school"><h3>{school?.name ?? ''}</h3>{school?.motto && <p className="report-motto">{school.motto}</p>}{(school?.address || school?.phone) && <p>{[school.address, school.phone].filter(Boolean).join(' · ')}</p>}</div>
        <div className="doc-title"><strong>Student record</strong><span>Printed {date(data.today)}</span></div></header>
      <h4>Student</h4>
      <dl className="doc-facts"><div><dt>Name</dt><dd>{l.fullName}</dd></div><div><dt>Admission number</dt><dd>{l.admissionNumber}</dd></div>
        <div><dt>Date of birth</dt><dd>{l.dateOfBirth ? `${date(l.dateOfBirth)} (${age} years)` : 'Not recorded'}</dd></div><div><dt>Sex</dt><dd>{sexText ?? 'Not recorded'}</dd></div>
        <div><dt>Class</dt><dd>{classText}</dd></div><div><dt>Enrolled since</dt><dd>{first ? date(first.startDate) : '–'}</dd></div></dl>
      <h4>Parents and guardians</h4>
      {data.guardians.length ? <ul className="plain-list">{data.guardians.map((g, i) => <li key={i}>{g.name}{g.phone ? ` · ${localPhone(g.phone)}` : ''}</li>)}</ul> : <p>None linked.</p>}
      <h4>Classes</h4>
      <table className="doc-history"><tbody>{data.enrolments.map((e, i) => <tr key={i}><td>{e.className}</td><td>From {date(e.startDate)}{e.endDate ? ` to ${date(e.endDate)}` : ' · now'}</td></tr>)}</tbody></table>
      {att?.marked ? <><h4>Attendance, {data.term?.name}</h4><p>{att.present} of {att.marked} days present ({att.late} late), {att.absent} absent, {att.excused} excused.</p></> : null}
      {subjects.length > 0 && <><h4>{data.term?.name} · {data.term?.yearName}</h4>
        <table className="doc-history"><thead><tr><th>Subject</th><th>CA</th><th>Exam</th><th>Total</th></tr></thead><tbody>{subjects.map(s => <tr key={s.subjectId}><td>{s.name}</td><td>{s.recordedCa ?? s.ca ?? '–'}</td><td>{s.exam ?? '–'}</td><td>{s.total ?? '–'}</td></tr>)}</tbody></table></>}
    </article>

    {planFor && data.currentClass && data.term && <SupportPlanDialog schoolId={schoolId} csrfToken={csrfToken} classId={data.currentClass.id} termId={data.term.id}
      draft={{ subjectId: planFor, learnerIds: [l.id], concern: '' }} subjects={subjects.map(s => ({ id: s.subjectId, name: s.name }))} roster={[{ learnerId: l.id, fullName: l.fullName }]}
      onClose={() => setPlanFor('')} onSaved={() => { setPlanFor(''); setMessage('Support plan started. It appears under Support plans and on the Performance page.'); void load(); }}/>}
  </section>;
}
