import React, { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Icon, PageHeader, Pill, Stat, Tone } from '../lib/ui';
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
  attendance: { marked: number; present: number; late: number; absent: number; excused: number; rate: number | null; absentDays: string[] } | null;
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

// One learner on one page: who they are and their family, how they are doing this term subject by subject (with the CA
// parts, the exam and anything worth a look), term by term, report cards, support plans, attendance, fees and notes.
export function LearnerPage({ schoolId, csrfToken, role, learnerId }: { schoolId: string; csrfToken: string; role: string; learnerId: string }) {
  const [termId, setTermId] = useState(''); const [data, setData] = useState<Profile | null>(null); const [error, setError] = useState('');
  const [planFor, setPlanFor] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try { setData(await request<Profile>(`/schools/${schoolId}/learners/${learnerId}/profile${termId ? `?termId=${termId}` : ''}`)); setError(''); } catch (e) { setError((e as Error).message); }
  }, [schoolId, learnerId, termId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const back = () => history.length > 1 ? history.back() : (location.hash = role === 'headteacher' ? '#/students' : '#/progress');
  if (error && !data) return <section className="page"><PageHeader eyebrow="Student" title="Student unavailable" blurb={error} actions={<button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>}/></section>;
  if (!data) return <p role="status">Loading…</p>;

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
  const facts = [l.admissionNumber, data.currentClass ? data.currentClass.name : 'Not currently enrolled', l.dateOfBirth ? `${ageOn(l.dateOfBirth, data.today)} years (born ${date(l.dateOfBirth)})` : null, l.sex === 'female' ? 'Girl' : l.sex === 'male' ? 'Boy' : null].filter(Boolean).join(' · ');
  return <section className="page learner-page" aria-label={`Student ${l.fullName}`}>
    <PageHeader eyebrow="Student" title={l.fullName} blurb={facts}
      actions={<><button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>
        {data.terms.length > 0 && <label className="inline-field">Term<select value={data.term?.id ?? ''} onChange={e => setTermId(e.target.value)}>{data.terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.yearName}</option>)}</select></label>}</>}/>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="stats">
      <Stat label="Attendance" value={att?.rate !== null && att?.rate !== undefined ? `${att.rate}%` : '–'} caption={att?.marked ? `${att.absent} absent, ${att.late} late of ${att.marked} days` : 'No registers yet this term'} icon="event_available" tone={att?.rate == null ? 'neutral' : att.rate >= 90 ? 'positive' : att.rate >= 80 ? 'caution' : 'critical'}/>
      <Stat label="Class work average" value={overall === null ? '–' : `${overall}%`} caption={withWork.length ? `${withWork.length} subject${withWork.length === 1 ? '' : 's'} this term` : 'No marks yet this term'} icon="insights" tone={tone(overall)}/>
      <Stat label="Worth a look" value={lookAt.length} caption={lookAt.length ? lookAt.map(s => s.name).join(', ') : 'Nothing flagged this term'} icon="flag" tone={lookAt.length ? 'caution' : 'neutral'}/>
      <Stat label="Support plans" value={openPlans.length} caption={openPlans.some(p => p.due) ? 'A review is due' : openPlans.length ? 'Open' : 'None open'} icon="volunteer_activism" tone={openPlans.some(p => p.due) ? 'caution' : 'neutral'}/>
    </div>
    <Card title={data.term ? `${data.term.name} · ${data.term.yearName}, subject by subject` : 'This term'} hint={tw?.policy ? `CA ${tw.policy.caWeight}% and exam ${tw.policy.examWeight}%. The CA comes from class work, weighted as the school sets it.` : undefined} flush>
          {!subjects.length ? <Empty title="Nothing recorded this term yet" hint="Class work, CA and exam scores appear here as teachers enter them."/>
            : <div className="table-wrap"><table className="ca-sheet"><thead><tr><th>Subject</th>{parts.map(([key, label]) => <th key={key} className="num">{label}</th>)}
                <th className="num">CA</th><th className="num">Exam</th><th className="num">Total</th><th>Worth a look</th></tr></thead><tbody>
              {subjects.map(s => <tr key={s.subjectId}><td>{s.name}{s.lastMarked && <span className="sub">Last mark {shortDate(s.lastMarked)}</span>}</td>
                {parts.map(([key]) => <td key={key} className="num"><Pct value={s.parts[key].average} sub={s.parts[key].set ? `${s.parts[key].marked} of ${s.parts[key].set}` : undefined}/></td>)}
                <td className="num"><Pct value={s.recordedCa ?? s.ca} sub={s.recordedCa === null ? (s.ca === null ? undefined : 'not saved') : undefined}/></td>
                <td className="num"><Pct value={s.exam}/></td><td className="num"><Pct value={s.total}/></td>
                <td><span className="pill-row">{s.attention && <Pill tone={s.attention.reason === 'dropping' ? 'critical' : 'caution'}>{s.attention.reason === 'dropping' ? `Dropping ${s.attention.earlier}% → ${s.attention.recent}%` : `Recent marks ${s.attention.recent}%`}</Pill>}
                  {s.gap && <Pill tone={s.gap.direction === 'exam_higher' ? 'caution' : 'info'}>{`Exam ${Math.round(Math.abs(s.gap.difference))} pts ${s.gap.direction === 'exam_higher' ? 'above' : 'below'} class work`}</Pill>}
                  {(() => { const missed = caPartLabels.reduce((n, [key]) => n + Math.max(0, s.parts[key].set - s.parts[key].marked), 0); return missed > 0 ? <Pill tone="neutral">{missed} piece{missed === 1 ? '' : 's'} of work without a mark</Pill> : null; })()}
                  {!s.attention && !s.gap && <span className="muted">–</span>}
                  {canPlan && (s.attention || s.gap) && (hasOpenPlan(s.name) ? <Pill tone="info">Plan open</Pill> : <button type="button" className="secondary small" onClick={() => { setMessage(''); setPlanFor(s.subjectId); }}>Plan</button>)}</span></td></tr>)}</tbody></table></div>}
          {gaps.length > 0 && <p className="muted card-body">An exam 20 or more points away from class work is worth a quiet conversation, for example about a bad exam day, missed class work, or work done with help. It is not proof of anything.</p>}
        </Card>
    <div className="columns">
      <div className="stack">
        <NotesCard schoolId={schoolId} csrfToken={csrfToken} learnerId={l.id} notes={data.notes} onChanged={() => void load()}/>
        <LearningNotes key={`learning-notes:${l.id}`} schoolId={schoolId} csrfToken={csrfToken} learnerId={l.id}/>
        <Card title="Term by term" hint="Term result (CA and exam) where recorded; otherwise the class work average for that term." flush>
          {!data.history.buckets.length ? <Empty title="No earlier terms yet"/>
            : <div className="table-wrap"><table className="trend-table"><thead><tr><th>Subject</th>{data.history.buckets.map(b => <th key={b.key}>{b.label}</th>)}</tr></thead><tbody>
              {data.history.subjects.map(s => <tr key={s.subjectId}><td>{s.name}</td>{s.points.map(p => <td key={p.key} className="num"><Pct value={p.termResult ?? p.assessmentAverage} sub={p.termResult !== null ? 'term result' : p.assessmentAverage !== null ? 'class work' : undefined}/></td>)}</tr>)}</tbody></table></div>}
        </Card>
      </div>
      <div className="stack">
        <Card title="Family">
          {!data.guardians.length ? <p className="muted">No parent linked yet.{role === 'headteacher' ? ' Link one on the Parents page.' : ''}</p>
            : <ul className="plain-list">{data.guardians.map((g, i) => <li key={i}><strong>{g.name}</strong>{!g.verified && <> <Pill tone="caution">not verified</Pill></>}
              <span className="sub">{g.rights.map(r => rightLabel[r] ?? r).join(', ')}{g.phone ? ` · ${g.phone}` : ''}</span></li>)}</ul>}
        </Card>
        <Card title="Support plans">
          {!data.plans.length ? <p className="muted">No support plans.</p>
            : <ul className="plain-list">{data.plans.map(p => <li key={p.id}><strong>{p.subject}{p.topic ? `: ${p.topic}` : ''}</strong> <Pill tone={p.closed ? 'neutral' : p.due ? 'caution' : 'info'}>{p.closed ? 'Closed' : p.due ? 'Review due' : 'Open'}</Pill>
              <span className="sub">{p.action} · {p.owner} · since {shortDate(p.startDate)}{!p.closed && p.nextReview ? ` · review ${shortDate(p.nextReview)}` : ''}</span></li>)}</ul>}
        </Card>
        <LearnerHomePractice key={`practice:${l.id}`} schoolId={schoolId} learnerId={l.id}/>
        {data.mock && <Card title="Latest mock exam">
          <p><strong className={`tone-${tone(data.mock.average)}`}>{data.mock.average ?? '–'}%</strong> {data.mock.round}{data.mock.change !== null && <span className="muted"> ({data.mock.change > 0 ? '+' : ''}{data.mock.change} on the round before)</span>}</p>
          {data.mock.needsSupport && <Pill tone="caution">Needs support in two or more subjects</Pill>}</Card>}
        <Card title="Attendance this term">
          {!att?.marked ? <p className="muted">No registers recorded for this term yet.</p>
            : <><p>{att.present} of {att.marked} days present ({att.late} late), {att.absent} absent, {att.excused} excused.</p>
              {att.absentDays.length > 0 && <p className="muted">Absent: {att.absentDays.map(shortDate).join(', ')}{att.absent > att.absentDays.length ? ' …' : ''}</p>}</>}
        </Card>
        <Card title="Report cards">
          {!data.reports.length ? <p className="muted">No published report cards yet.</p>
            : <ul className="plain-list">{data.reports.map(r => <li key={r.term_id}><strong>{r.term_name} · {r.year_name}</strong><span className="sub">{r.class_name} · average {r.average ?? '–'}{r.position ? ` · position ${r.position} of ${r.class_size}` : ''}{r.revision > 1 ? ` · corrected (revision ${r.revision})` : ''}</span>
              {r.teacher_remark && <span className="sub">“{r.teacher_remark}”</span>}</li>)}</ul>}
        </Card>
        {data.fees && <Card title="Fees">
          {!data.fees.length ? <p className="muted">No bills yet.</p>
            : <ul className="plain-list">{data.fees.map(f => <li key={f.id}><strong>{f.term_name} · {f.year_name}</strong><span className="sub">Billed {cedis(f.total_pesewas)} · paid {cedis(f.paid_pesewas)}{f.balance_pesewas > 0 ? ` · owing ${cedis(f.balance_pesewas)}` : ' · paid in full'}</span></li>)}</ul>}
        </Card>}
        <Card title="Classes">
          <ul className="plain-list">{data.enrolments.map((e, i) => <li key={i}><strong>{e.className}</strong><span className="sub">From {date(e.startDate)}{e.endDate ? ` to ${date(e.endDate)}${e.endReason ? ` (${e.endReason})` : ''}` : ''}</span></li>)}</ul>
        </Card>
      </div>
    </div>
    {planFor && data.currentClass && data.term && <SupportPlanDialog schoolId={schoolId} csrfToken={csrfToken} classId={data.currentClass.id} termId={data.term.id}
      draft={{ subjectId: planFor, learnerIds: [l.id], concern: '' }} subjects={subjects.map(s => ({ id: s.subjectId, name: s.name }))} roster={[{ learnerId: l.id, fullName: l.fullName }]}
      onClose={() => setPlanFor('')} onSaved={() => { setPlanFor(''); setMessage('Support plan started. It appears under Support plans and on the Performance page.'); void load(); }}/>}
  </section>;
}
