import React, { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Icon, Pill, currentTerm, type Tone } from '../lib/ui';
import { cedis } from './Finance';

type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type FollowClass = { class_id: string; name: string; level: string; learners: number; register_status: string };
type FollowUp = { day: string; open: boolean; classes: FollowClass[]; outstanding?: number };
type Absent = { learner_id: string; full_name: string; admission_number: string; class_name: string; absences: number; last_absent_day: string };
type ClassOption = { id: string; name: string; level: string; year_name: string };
type RosterLearner = { id: string; full_name: string; admission_number: string };
type Term = { id: string; name: string; start_date?: string; end_date?: string };
type FeeSummary = { term: string; billedPesewas: number; outstandingPesewas: number };
type Attention = { icon: string; tone: Tone; text: string; detail: string; href: string; go: string };

const label: Record<string, string> = { missing: 'Not started', draft: 'Draft, not submitted', submitted: 'Submitted', locked: 'Locked' };
const tone: Record<string, Tone> = { missing: 'critical', draft: 'caution', submitted: 'positive', locked: 'neutral' };

export function AttendanceFollowUp({ schoolId }: { schoolId: string }) {
  const [follow, setFollow] = useState<FollowUp | null>(null);
  const [absent, setAbsent] = useState<Absent[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [printClass, setPrintClass] = useState('');
  const [sheet, setSheet] = useState<{ title: string; learners: RosterLearner[]; date: string } | null>(null);
  const [absentTotal, setAbsentTotal] = useState(0);
  const [fees, setFees] = useState<FeeSummary | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [f, a, c] = await Promise.all([
        request<FollowUp>(`/schools/${schoolId}/attendance/follow-up`),
        request<Page<Absent>>(`/schools/${schoolId}/attendance/repeated-absence?limit=50`),
        request<Page<ClassOption>>(`/schools/${schoolId}/teaching/class-options?limit=100`),
      ]);
      setFollow(f); setAbsent(a.items); setAbsentTotal(a.total); setClasses(c.items); setPrintClass(prior => prior || c.items[0]?.id || '');
    } catch (e) { setError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void load(); }, [load]);
  // Fees and admissions for the "Needs attention" card; either may be unavailable without hiding the rest of the page.
  useEffect(() => {
    request<{ items: Term[] }>(`/schools/${schoolId}/finance/terms`).then(async t => {
      const term = currentTerm(t.items); if (!term) return;
      const s = await request<{ billedPesewas: number; outstandingPesewas: number }>(`/schools/${schoolId}/finance/summary?termId=${term.id}`);
      setFees({ term: term.name, billedPesewas: s.billedPesewas, outstandingPesewas: s.outstandingPesewas });
    }).catch(() => undefined);
    (async () => {
      let count = 0;
      for (let offset = 0; offset < 1000; offset += 100) {
        const page = await request<Page<{ status: string }>>(`/schools/${schoolId}/admissions?limit=100&offset=${offset}`);
        count += page.items.filter(a => a.status === 'application' || a.status === 'review').length;
        if (offset + page.items.length >= page.total || !page.items.length) break;
      }
      setWaiting(count);
    })().catch(() => undefined);
  }, [schoolId]);

  async function printBlank() {
    const chosen = classes.find(c => c.id === printClass); if (!chosen) return;
    setError('');
    try {
      const date = follow?.day ?? new Date().toISOString().slice(0, 10);
      const learners: RosterLearner[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await request<Page<RosterLearner>>(`/schools/${schoolId}/teaching/classes/${chosen.id}/roster?date=${date}&limit=100&offset=${offset}`);
        learners.push(...page.items); if (learners.length >= page.total || !page.items.length) break;
      }
      setSheet({ title: `${chosen.name} · ${chosen.year_name}`, learners, date });
      setTimeout(() => window.print(), 100);
    } catch (e) { setError((e as Error).message); }
  }

  const missing = follow?.open ? follow.classes.filter(c => c.register_status === 'missing').length : 0;
  const drafts = follow?.open ? follow.classes.filter(c => c.register_status === 'draft').length : 0;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const attention: Attention[] = [
    ...(missing ? [{ icon: 'event_busy', tone: 'critical' as Tone, text: `${plural(missing, 'class has', 'classes have')} no register today`, detail: follow!.classes.filter(c => c.register_status === 'missing').slice(0, 4).map(c => c.name).join(', ') + (missing > 4 ? '…' : ''), href: '#/attendance', go: 'Open registers' }] : []),
    ...(drafts ? [{ icon: 'edit_note', tone: 'caution' as Tone, text: `${plural(drafts, 'register is', 'registers are')} saved but not submitted`, detail: 'Teachers still need to submit today’s marks.', href: '#/attendance', go: 'Open registers' }] : []),
    ...(absentTotal ? [{ icon: 'person_alert', tone: 'caution' as Tone, text: `${plural(absentTotal, 'learner is', 'learners are')} often absent`, detail: `3 or more absences in the last 14 days${absent[0] ? `, including ${absent[0].full_name}` : ''}`, href: '#/attendance', go: 'Check registers' }] : []),
    ...(fees && fees.outstandingPesewas > 0 ? [{ icon: 'account_balance_wallet', tone: 'critical' as Tone, text: `${cedis(fees.outstandingPesewas)} in fees outstanding`, detail: `${Math.round(fees.outstandingPesewas / Math.max(fees.billedPesewas, 1) * 100)}% of the ${cedis(fees.billedPesewas)} billed for ${fees.term}`, href: '#/fees', go: 'Open fees' }] : []),
    ...(waiting ? [{ icon: 'how_to_reg', tone: 'info' as Tone, text: `${plural(waiting, 'admission is', 'admissions are')} waiting for a decision`, detail: 'New applications and applications under review.', href: '#/learners/applications', go: 'Review applications' }] : []),
  ];

  return <section aria-label="Attendance follow-up" className="page">
    {error && <p role="alert">{error}</p>}
    {follow && <Card title="Needs attention" hint={attention.length ? 'Today’s open items, most urgent first.' : undefined} flush>
      {attention.length ? <ul className="attention">{attention.map(item => <li key={item.text}>
        <span className={`stat-icon tone-${item.tone}`}><Icon name={item.icon}/></span>
        <div><strong>{item.text}</strong><span className="sub">{item.detail}</span></div>
        <a className="button secondary" href={item.href}>{item.go}</a>
      </li>)}</ul> : <Empty title="Nothing needs your attention" hint="Registers, absences, fees and admissions are all up to date."/>}
    </Card>}
    <div className="columns">
      <Card title="Attendance follow-up" hint={follow ? (follow.open ? `Registers for ${follow.day} · ${follow.outstanding} outstanding` : `${follow.day} is not an open school day`) : 'Loading…'} action={<a className="button secondary" href="#/attendance">Open registers</a>} flush>
        {follow && (follow.open
          ? (follow.classes.length ? <div className="table-wrap"><table><thead><tr><th>Class</th><th className="num">Learners</th><th>Register</th></tr></thead>
            <tbody>{follow.classes.map(c => <tr key={c.class_id}><td>{c.name}<span className="sub">{c.level}</span></td><td className="num">{c.learners}</td><td><Pill tone={tone[c.register_status] ?? 'neutral'}>{label[c.register_status] ?? c.register_status}</Pill></td></tr>)}</tbody></table></div>
            : <Empty title="No classes to mark today"/>)
          : <Empty title="No registers are due" hint="Today is not an open school day."/>)}
      </Card>
      <div>
        <Card title="Learners often absent" hint="3 or more absences in the last 14 days" flush>
          {absent.length ? <div className="table-wrap"><table><tbody>{absent.map(a => <tr key={a.learner_id}><td>{a.full_name}<span className="sub">{a.class_name} · last {a.last_absent_day}</span></td><td className="num"><Pill tone="critical">{a.absences} absent</Pill></td></tr>)}</tbody></table></div>
            : <p className="muted">No learners have reached the threshold.</p>}
        </Card>
        <Card title="Printable register" hint="For a power or network outage">
          <label>Class<select value={printClass} onChange={e => setPrintClass(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
          <button type="button" className="secondary" disabled={!printClass} onClick={() => void printBlank()}>Print blank register</button>
        </Card>
      </div>
    </div>
    {sheet && <div className="print-sheet"><h2>{sheet.title}</h2><p>Register for the week starting ____________ (roster as at {sheet.date})</p>
      <table><thead><tr><th>Name</th><th>No.</th>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => <th key={d}>{d}</th>)}</tr></thead>
        <tbody>{sheet.learners.map(l => <tr key={l.id}><td>{l.full_name}</td><td>{l.admission_number}</td>{[0, 1, 2, 3, 4].map(i => <td key={i}/>)}</tr>)}</tbody></table>
      <p>Mark P present, L late, A absent, E excused. Enter into the system when it is available again.</p></div>}
  </section>;
}
