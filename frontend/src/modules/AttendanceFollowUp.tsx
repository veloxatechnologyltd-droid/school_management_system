import React, { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Icon, Pill, currentTerm, type Tone } from '../lib/ui';
import { cedis } from './Finance';

type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type FollowClass = { class_id: string; name: string; level: string; learners: number; register_status: string };
type FollowUp = { day: string; open: boolean; classes: FollowClass[]; outstanding?: number };
type Absent = { learner_id: string; full_name: string; class_name: string; absences: number; last_absent_day: string; guardian_name: string | null; phone: string | null };
type Morning = {
  day: string; weekStart: string; open: boolean;
  registers: { class_id: string; name: string; status: 'missing' | 'draft' }[];
  absences: Absent[];
  fees: { term: string; collectedPesewas: number; previous: { term: string; collectedPesewas: number } | null } | null;
  scores: { term: string; endsOn: string; daysLeft: number; classes: { class_id: string; name: string; missing: number; subjects: string[]; not_started: boolean }[] } | null;
  support?: { id: string; class_name: string; subject_name: string; owner_name: string; review_date: string; learners: number }[];
};
type ClassOption = { id: string; name: string; level: string; year_name: string };
type RosterLearner = { id: string; full_name: string; admission_number: string };
type Term = { id: string; name: string; start_date?: string; end_date?: string };
type FeeSummary = { term: string; billedPesewas: number; outstandingPesewas: number };
type Attention = { icon: string; tone: Tone; text: string; detail: string; href: string; go: string };

const label: Record<string, string> = { missing: 'Not started', draft: 'Draft, not submitted', submitted: 'Submitted', locked: 'Locked' };
const tone: Record<string, Tone> = { missing: 'critical', draft: 'caution', submitted: 'positive', locked: 'neutral' };

export function AttendanceFollowUp({ schoolId }: { schoolId: string }) {
  const [follow, setFollow] = useState<FollowUp | null>(null);
  const [morning, setMorning] = useState<Morning | null>(null);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [printClass, setPrintClass] = useState('');
  const [sheet, setSheet] = useState<{ title: string; learners: RosterLearner[]; date: string } | null>(null);
  const [fees, setFees] = useState<FeeSummary | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [f, m, c] = await Promise.all([
        request<FollowUp>(`/schools/${schoolId}/attendance/follow-up`),
        request<Morning>(`/schools/${schoolId}/home/morning`),
        request<Page<ClassOption>>(`/schools/${schoolId}/teaching/class-options?limit=100`),
      ]);
      setFollow(f); setMorning(m); setClasses(c.items); setPrintClass(prior => prior || c.items[0]?.id || '');
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

  const outstanding = follow?.classes.filter(c => c.register_status === 'missing' || c.register_status === 'draft') ?? [];
  const visibleClasses = showAll ? follow?.classes ?? [] : outstanding;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const names = (list: string[]) => list.slice(0, 4).join(', ') + (list.length > 4 ? '…' : '');
  const missing = morning?.registers.filter(r => r.status === 'missing') ?? [], drafts = morning?.registers.filter(r => r.status === 'draft') ?? [];
  const absent = morning?.absences ?? [], unreachable = absent.filter(a => !a.phone);
  const week = morning?.fees, scoreGaps = morning?.scores && morning.scores.daysLeft <= 21 ? morning.scores.classes : [];
  const attention: Attention[] = [
    ...(missing.length ? [{ icon: 'event_busy', tone: 'critical' as Tone, text: `${plural(missing.length, 'class has', 'classes have')} no register today`, detail: names(missing.map(c => c.name)), href: '#/attendance', go: 'Open registers' }] : []),
    ...(drafts.length ? [{ icon: 'edit_note', tone: 'caution' as Tone, text: `${plural(drafts.length, 'register is', 'registers are')} saved but not submitted`, detail: names(drafts.map(c => c.name)), href: '#/attendance', go: 'Open registers' }] : []),
    ...(absent.length ? [{ icon: 'person_alert', tone: 'caution' as Tone, text: `${plural(absent.length, 'learner has', 'learners have')} been absent 3 or more days this week`,
      detail: unreachable.length ? `No guardian phone on file for ${names(unreachable.map(a => a.full_name))}` : 'Guardian phone numbers are listed below.',
      href: unreachable.length ? '#/guardians' : '#/attendance', go: unreachable.length ? 'Add guardian contacts' : 'Check registers' }] : []),
    ...(week ? [{ icon: 'payments', tone: (week.previous && week.collectedPesewas < week.previous.collectedPesewas ? 'caution' : 'positive') as Tone, text: `${cedis(week.collectedPesewas)} in fees collected this week`,
      detail: week.previous ? `${cedis(week.previous.collectedPesewas)} in the same week of ${week.previous.term}` : `No earlier term to compare with`, href: '#/fees', go: 'Open fees' }] : []),
    ...(scoreGaps.length ? [{ icon: 'grading', tone: 'caution' as Tone, text: `${plural(scoreGaps.length, 'class is', 'classes are')} missing scores`,
      detail: `${morning!.scores!.term} ends ${morning!.scores!.daysLeft > 0 ? `in ${plural(morning!.scores!.daysLeft, 'day', 'days')}` : 'today'}: ${names(scoreGaps.map(c => c.not_started ? `${c.name} (none yet)` : `${c.name} (${c.subjects.join(', ')})`))}`, href: '#/assessment', go: 'Open scores' }] : []),
    ...(morning?.support?.length ? [{ icon: 'event_upcoming', tone: 'caution' as Tone, text: `${plural(morning.support.length, 'support review is', 'support reviews are')} due`,
      detail: names(morning.support.map(p => `${p.class_name} ${p.subject_name} (${p.owner_name})`)), href: '#/progress/support', go: 'Review plans' }] : []),
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
          ? (follow.classes.length ? <>
            <div className="toolbar"><span className="count">{showAll ? `All ${follow.classes.length} classes` : `${outstanding.length} of ${follow.classes.length} classes still to do`}</span><button type="button" className="secondary" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show only outstanding' : `Show all ${follow.classes.length} classes`}</button></div>
            {visibleClasses.length ? <div className="table-wrap"><table><thead><tr><th>Class</th><th className="num">Learners</th><th>Register</th></tr></thead>
            <tbody>{visibleClasses.map(c => <tr key={c.class_id}><td>{c.name}<span className="sub">{c.level}</span></td><td className="num">{c.learners}</td><td><Pill tone={tone[c.register_status] ?? 'neutral'}>{label[c.register_status] ?? c.register_status}</Pill></td></tr>)}</tbody></table></div>
            : <Empty title="Every register is in" hint="All classes have submitted today’s register."/>}</>
            : <Empty title="No classes to mark today"/>)
          : <Empty title="No registers are due" hint="Today is not an open school day."/>)}
      </Card>
      <div>
        <Card title="Absent 3 or more days this week" hint={morning ? `Since Monday ${morning.weekStart}, from submitted registers` : undefined} flush>
          {absent.length ? <div className="table-wrap"><table><tbody>{absent.map(a => <tr key={a.learner_id}><td>{a.full_name}<span className="sub">{a.class_name} · last {a.last_absent_day}</span></td>
            <td>{a.guardian_name ? <>{a.guardian_name}{a.phone ? <a className="sub" href={`tel:${a.phone}`}>{a.phone}</a> : <span className="sub">No phone on file</span>}</> : <span className="muted">No guardian contact</span>}</td>
            <td className="num"><Pill tone="critical">{a.absences} absent</Pill></td></tr>)}</tbody></table></div>
            : <p className="muted">No learner has been absent 3 or more days this week.</p>}
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
