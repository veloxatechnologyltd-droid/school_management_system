import React, { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Icon, Pill, Stat, Tabs, type Tone } from '../lib/ui';
import { cedis } from './Finance';
import { NeedsAttention, RegistersToday, useFollowUp } from './AttendanceFollowUp';

type Period = 'today' | 'week' | 'term';
type Filters = { termId: string; level: string; classId: string; period: Period };
type Day = { day: string; rate: number | null; marked: number; away: number; registers: number };
type Overview = {
  day: string;
  term: { id: string; name: string; yearName: string; start: string; end: string; current: boolean } | null;
  terms: { id: string; name: string; year_name: string }[];
  classes: { id: string; name: string; level: string }[];
  levels: string[];
  scope: { level: string | null; classId: string | null; classes: number };
  period: Period;
  students: { total: number; female: number; male: number; asOf: string; byLevel: { level: string; count: number }[] };
  attendance: {
    from: string; to: string; rate: number | null; present: number; away: number; marked: number; daysCounted: number; previousRate: number | null; previousLabel: string;
    registers: { expected: number; in: number; waiting: string[] } | null; daily: Day[];
    byClass: { classId: string; name: string; level: string; learners: number; rate: number | null; away: number; marked: number }[];
  };
  fees: {
    billedPesewas: number; collectedPesewas: number; outstandingPesewas: number; rate: number | null; invoices: number; inPeriodPesewas: number; weeks: { week: string; collectedPesewas: number }[];
    byClass: { classId: string; name: string; level: string; billedPesewas: number; collectedPesewas: number; outstandingPesewas: number; rate: number | null }[];
  };
  scores: {
    passLine: number; expected: number; entered: number; classes: number; started: number; belowPass: number; scored: number;
    byClass: { classId: string; name: string; level: string; learners: number; subjects: number; expected: number; entered: number; caAverage: number | null; examAverage: number | null; scored: number; belowPass: number }[];
    bySubject: { subjectId: string; name: string; classes: number; expected: number; entered: number; caAverage: number | null; examAverage: number | null }[];
  };
  admissions: { application: number; review: number; offered: number; waitlisted: number; accepted: number; waiting: number };
  capacity: { classId: string; name: string; level: string; capacity: number; enrolled: number }[];
};

const DEFAULTS: Filters = { termId: '', level: '', classId: '', period: 'week' };
const periodName: Record<Period, string> = { today: 'Today', week: 'This week', term: 'This term' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pctText = (n: number | null) => n === null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
// Whole cedis, and thousands as 105.3K, so a figure fits a tile; the Fees panel shows the exact amount.
const cedisShort = (pesewas: number) => { const c = Math.round(pesewas / 100); return c >= 1_000_000 ? `GH₵ ${(c / 1_000_000).toFixed(1)}M` : c >= 10_000 ? `GH₵ ${(c / 1000).toFixed(1)}K` : `GH₵ ${c.toLocaleString('en-GH')}`; };
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const names = (list: string[]) => list.slice(0, 4).join(', ') + (list.length > 4 ? '…' : '');

// A thin bar on a lighter track; decorative, because the number beside it says the same thing.
function Meter({ value, critical = false }: { value: number | null; critical?: boolean }) {
  return <span className={critical ? 'meter is-critical' : 'meter'} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}/></span>;
}

// One row per class with a bar; choosing a row narrows the whole overview to that class. Long lists show the first few.
type RowData = { id: string; name: string; sub?: string; bar: number | null; text: string; critical?: boolean };
function Rows({ rows, label, onPick, limit = 6 }: { rows: RowData[]; label: string; onPick?: (id: string) => void; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  return <>
    <ul className="bar-rows" aria-label={label}>{shown.map(row => {
      const inner = <><span className="bar-name">{row.name}{row.sub && <span className="sub">{row.sub}</span>}</span><Meter value={row.bar} critical={row.critical}/><span className="bar-value">{row.text}</span></>;
      return <li key={row.id}>{onPick
        ? <button type="button" className="bar-row" aria-label={`${row.name}: ${row.text}. Show this class only`} onClick={() => onPick(row.id)}>{inner}</button>
        : <div className="bar-row">{inner}</div>}</li>;
    })}</ul>
    {rows.length > limit && <button type="button" className="secondary bar-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
  </>;
}

// Columns from a baseline, one per school day or week. The pointer anywhere over the chart finds the nearest column, so a thin
// column is not a small target; the same values are in the table underneath for keyboards and screen readers.
type Bar = { key: string; value: number | null; on: boolean; title: string; detail: string };
function Columns({ bars, max, top, label, unit }: { bars: Bar[]; max: number; top: string; label: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const at = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(bars.length - 1, Math.floor((event.clientX - box.left) / box.width * bars.length))));
  };
  const tip = hover === null ? null : bars[hover];
  return <figure className="chart">
    <div className="chart-plot" onPointerMove={at} onPointerDown={at} onPointerLeave={() => setHover(null)}>
      <span className="chart-axis top">{top}</span><span className="chart-axis bottom">0</span>
      <div className="chart-bars" role="img" aria-label={label}>{bars.map((bar, i) => <span key={bar.key} className={`chart-col${bar.on ? ' on' : ''}${hover === i ? ' hot' : ''}`}>
        {bar.value !== null && bar.value > 0 && <span style={{ height: `${Math.min(100, bar.value / max * 100)}%` }}/>}</span>)}</div>
      {tip && <div className="chart-tip" style={{ left: `${(hover! + .5) / bars.length * 100}%` }}><strong>{tip.detail}</strong><span>{tip.title}</span></div>}
    </div>
    <div className="chart-x"><span>{bars[0]?.title}</span><span>{bars[bars.length - 1]?.title}</span></div>
    <details className="chart-table"><summary>View as a table</summary>
      <div className="table-wrap"><table><thead><tr><th>{unit}</th><th className="num">Value</th></tr></thead><tbody>{bars.map(bar => <tr key={bar.key}><td>{bar.title}</td><td className="num">{bar.detail}</td></tr>)}</tbody></table></div>
    </details>
  </figure>;
}

function Panels({ data, pick }: { data: Overview; pick: (classId: string) => void }) {
  const { attendance: att, fees, scores, admissions, term } = data;
  const [by, setBy] = useState<'class' | 'subject'>('class');
  const [allScores, setAllScores] = useState(false);
  const one = !!data.scope.classId, choose = one ? undefined : pick;
  const days = data.period === 'term' ? att.daily : att.daily.slice(-20);
  const weekly = fees.weeks;
  const weeklyMax = Math.max(1, ...weekly.map(w => w.collectedPesewas));
  const coverage = scores.expected ? Math.round(scores.entered * 1000 / scores.expected) / 10 : null;
  return <div className="overview-grid">
    <Card title="Attendance" hint={`Present or late, of those marked · ${short(att.from)}${att.to !== att.from ? ` – ${short(att.to)}` : ''}`} action={<a className="button secondary" href="#/attendance">Open attendance</a>}>
      {days.length ? <Columns bars={days.map(d => ({ key: d.day, value: d.rate, on: d.day >= att.from && d.day <= att.to, title: short(d.day), detail: d.rate === null ? 'No marks' : `${pctText(d.rate)} · ${d.away} absent` }))}
        max={100} top="100%" unit="School day" label={`Attendance rate for the last ${plural(days.length, 'school day', 'school days')}`}/>
        : <Empty title="No registers submitted yet" hint="Rates appear once teachers submit a register for the term."/>}
      {att.registers && <p className="panel-line"><Icon name="event_available"/>{att.registers.in} of {plural(att.registers.expected, 'class', 'classes')} have submitted today’s register{att.registers.waiting.length ? `. Waiting: ${names(att.registers.waiting)}` : '.'}</p>}
      {att.byClass.length > 0 && <><h4 className="panel-sub">{one ? 'This class' : 'By class, lowest first'}</h4>
        <Rows label="Attendance by class" onPick={choose} rows={att.byClass.map(c => ({ id: c.classId, name: c.name, sub: c.marked ? `${plural(c.away, 'absence', 'absences')} · ${plural(c.learners, 'student', 'students')}` : `${plural(c.learners, 'student', 'students')} · no registers`, bar: c.rate, text: pctText(c.rate) }))}/></>}
    </Card>
    <Card title="Fees" hint={`${term!.name} · money received against what was billed`} action={<a className="button secondary" href="#/accounts">Open accounts</a>}>
      {fees.invoices ? <>
        <div className="fees-head"><div><strong className="fees-big">{cedis(fees.collectedPesewas)}</strong><span className="muted"> collected of {cedis(fees.billedPesewas)} billed</span></div><Pill tone="info">{pctText(fees.rate)}</Pill></div>
        <Meter value={fees.rate}/>
        <p className="panel-line"><Icon name="account_balance_wallet"/>{cedis(fees.outstandingPesewas)} still to collect from {plural(fees.invoices, 'bill', 'bills')}.</p>
        {weekly.length > 1 && <Columns bars={weekly.map(w => ({ key: w.week, value: w.collectedPesewas, on: w.week >= att.from || data.period === 'term', title: `Week of ${short(w.week)}`, detail: cedis(w.collectedPesewas) }))}
          max={weeklyMax} top={cedis(weeklyMax)} unit="Week" label="Fees received each week of the term"/>}
        <h4 className="panel-sub">{one ? 'This class' : 'By class, most outstanding first'}</h4>
        <Rows label="Fees by class" onPick={choose} rows={fees.byClass.map(c => ({ id: c.classId, name: c.name, sub: `${cedis(c.collectedPesewas)} of ${cedis(c.billedPesewas)}`, bar: c.rate, text: c.outstandingPesewas > 0 ? `${cedis(c.outstandingPesewas)} owed` : 'Paid up' }))}/>
      </> : <Empty title="No bills for this term yet" hint="Fees appear here once bills are generated under Accounts."/>}
    </Card>
    <Card title="Scores" hint={`CA and exam scores entered · ${term!.name}`} action={<a className="button secondary" href="#/assessment">Open assessment</a>}>
      {scores.started ? <>
        <div className="fees-head"><div><strong className="fees-big">{pctText(coverage)}</strong><span className="muted"> of expected scores entered ({scores.entered} of {scores.expected})</span></div></div>
        <Meter value={coverage}/>
        <p className="panel-line"><Icon name="school"/>{scores.scored ? <>{plural(scores.belowPass, 'student averages', 'students average')} under {scores.passLine}% across the scores entered, of {scores.scored} with scores.</> : 'No student has a score yet.'}</p>
        <div className="actions"><Tabs label="Scores view" value={by} onChange={setBy} options={[{ id: 'class', label: 'By class' }, { id: 'subject', label: 'By subject' }]}/></div>
        <div className="table-wrap"><table className="compact"><thead><tr><th>{by === 'class' ? 'Class' : 'Subject'}</th><th className="num">CA</th><th className="num">Exam</th><th className="num">Entered</th></tr></thead>
          <tbody>{(by === 'class' ? scores.byClass : scores.bySubject).slice(0, allScores ? undefined : 6).map(row => 'classId' in row
            ? <tr key={row.classId}><td>{one ? row.name : <button type="button" className="link-button" onClick={() => pick(row.classId)}>{row.name}</button>}<span className="sub">{row.subjects ? `${plural(row.belowPass, 'student', 'students')} under ${scores.passLine}%` : plural(row.learners, 'student', 'students')}</span></td>
              <td className="num">{row.subjects ? row.caAverage ?? '—' : <Pill>Not started</Pill>}</td><td className="num">{row.subjects ? row.examAverage ?? '—' : ''}</td><td className="num">{row.subjects ? `${Math.round(row.entered * 100 / row.expected)}%` : ''}</td></tr>
            : <tr key={row.subjectId}><td>{row.name}<span className="sub">{plural(row.classes, 'class', 'classes')}</span></td><td className="num">{row.caAverage ?? '—'}</td><td className="num">{row.examAverage ?? '—'}</td><td className="num">{Math.round(row.entered * 100 / row.expected)}%</td></tr>)}</tbody></table></div>
        {(by === 'class' ? scores.byClass : scores.bySubject).length > 6 && <button type="button" className="secondary bar-more" onClick={() => setAllScores(!allScores)}>{allScores ? 'Show fewer' : `Show all ${(by === 'class' ? scores.byClass : scores.bySubject).length}`}</button>}
      </> : <Empty title="No scores entered yet" hint={scores.classes ? `${plural(scores.classes, 'Primary or JHS class has', 'Primary and JHS classes have')} no scores for ${term!.name}. Teachers enter them under Assessment.` : 'Scores are for Primary and JHS classes.'}/>}
    </Card>
    <Card title="Admissions and places" hint="Applications still open, and how full each class is" action={<a className="button secondary" href="#/students/applications">Open applications</a>}>
      <dl className="pipeline">{([['New', admissions.application], ['In review', admissions.review], ['Offered', admissions.offered], ['Waitlisted', admissions.waitlisted], ['Accepted', admissions.accepted]] as const).map(([name, n]) => <div key={name}><dt>{name}</dt><dd>{n}</dd></div>)}</dl>
      {data.capacity.length > 0 ? <><h4 className="panel-sub">{one ? 'This class' : 'Places by class, fullest first'}</h4>
        <Rows label="Places by class" onPick={choose} rows={data.capacity.map(c => ({ id: c.classId, name: c.name, sub: c.enrolled >= c.capacity ? 'Full' : plural(c.capacity - c.enrolled, 'place left', 'places left'), bar: c.enrolled * 100 / c.capacity, text: `${c.enrolled} of ${c.capacity}`, critical: c.enrolled >= c.capacity }))}/></>
        : <Empty title="No classes here" hint="This term has no classes for the chosen level."/>}
    </Card>
  </div>;
}

function Dashboard({ schoolId, attention }: { schoolId: string; attention: ReturnType<typeof useFollowUp> }) {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const latest = useRef(0);
  useEffect(() => {
    const mine = ++latest.current;
    setBusy(true); setError('');
    const query = new URLSearchParams({ period: filters.period });
    if (filters.termId) query.set('termId', filters.termId);
    if (filters.level) query.set('level', filters.level);
    if (filters.classId) query.set('classId', filters.classId);
    request<Overview>(`/schools/${schoolId}/home/overview?${query}`).then(next => {
      if (mine !== latest.current) return;
      setData(next);
      // A class belongs to one year; after a term change the old choice may not exist.
      if (filters.classId && !next.classes.some(c => c.id === filters.classId)) setFilters(prior => ({ ...prior, classId: '' }));
    }).catch(e => { if (mine === latest.current) setError((e as Error).message); }).finally(() => { if (mine === latest.current) setBusy(false); });
  }, [schoolId, filters]);

  const term = data?.term ?? null;
  const change = (patch: Partial<Filters>) => setFilters(prior => ({ ...prior, ...patch }));
  const classes = data?.classes.filter(c => !filters.level || c.level === filters.level) ?? [];
  const touched = filters.termId !== '' || filters.level !== '' || filters.classId !== '' || filters.period !== 'week';
  const chosen = data?.classes.find(c => c.id === filters.classId);

  const filterBar = data && term && <div className="filters" role="group" aria-label="Filters">
    <label>Term<select value={term.id} onChange={e => change({ termId: e.target.value, classId: '' })}>{data.terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>
    <label>Level<select value={filters.level} onChange={e => change({ level: e.target.value, classId: chosen && chosen.level !== e.target.value && e.target.value ? '' : filters.classId })}><option value="">All levels</option>{data.levels.map(l => <option key={l}>{l}</option>)}</select></label>
    <label>Class<select value={filters.classId} onChange={e => change({ classId: e.target.value })}><option value="">All classes</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="filter-period"><span className="filter-label" id="period-label">Period</span>
      <div className="segmented" role="group" aria-labelledby="period-label">{(['today', 'week', 'term'] as Period[]).map(p => <button key={p} type="button" aria-pressed={data.period === p} disabled={!term.current && p !== 'term'} title={!term.current && p !== 'term' ? 'Only the current term has a today or a week' : undefined} onClick={() => change({ period: p })}>{periodName[p]}</button>)}</div></div>
    {touched && <button type="button" className="secondary" onClick={() => setFilters(DEFAULTS)}>Reset filters</button>}
  </div>;

  const att = data?.attendance, delta = att && att.rate !== null && att.previousRate !== null ? Math.round((att.rate - att.previousRate) * 10) / 10 : null;
  const scope = data && term ? [term.name, data.scope.classId ? chosen?.name : data.scope.level ?? 'All levels', periodName[data.period]].join(' · ') : '';
  const stats = data && term && att && <div className="stats head-stats">
    <Stat label="Students" value={data.students.total} icon="groups" caption={data.students.female + data.students.male ? `${plural(data.students.female, 'girl', 'girls')} · ${plural(data.students.male, 'boy', 'boys')}${data.students.total > data.students.female + data.students.male ? ` · ${data.students.total - data.students.female - data.students.male} not recorded` : ''}` : plural(data.scope.classes, 'class', 'classes')}/>
    <Stat label="Attendance" value={pctText(att.rate)} icon="event_available" caption={<>{att.marked ? `${plural(att.away, 'absence', 'absences')}${data.period === 'today' ? '' : ` · ${plural(att.daysCounted, 'school day', 'school days')}`}` : data.period === 'today' && !att.registers ? 'Not an open school day' : 'No registers submitted'}
      {delta !== null && delta !== 0 && <span className={`delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)} pts vs {/^\d/.test(att.previousLabel) ? short(att.previousLabel) : att.previousLabel}</span>}</>}/>
    <Stat label="Fees collected" value={cedisShort(data.fees.inPeriodPesewas)} icon="payments" caption={!data.fees.invoices ? 'No bills for this term' : data.period === 'term' ? `${pctText(data.fees.rate)} of what was billed` : `${periodName[data.period]} · ${cedisShort(data.fees.collectedPesewas)} this term`}/>
    <Stat label="Fees owed" value={cedisShort(data.fees.outstandingPesewas)} icon="account_balance_wallet" tone={data.fees.outstandingPesewas > 0 ? 'critical' as Tone : 'neutral'} caption={data.fees.invoices ? `${pctText(data.fees.billedPesewas ? Math.round((100 - (data.fees.rate ?? 0)) * 10) / 10 : null)} of ${cedisShort(data.fees.billedPesewas)} billed` : 'No bills for this term'}/>
    <Stat label="Scores entered" value={data.scores.expected ? pctText(Math.round(data.scores.entered * 1000 / data.scores.expected) / 10) : '—'} icon="grading" caption={data.scores.classes ? `${data.scores.started} of ${plural(data.scores.classes, 'class has', 'classes have')} started` : 'Primary and JHS only'}/>
  </div>;

  return <>
    {error && <p role="alert">{error}</p>}
    {filterBar}
    {term && <p className="scope-line" role="status">Showing {scope}{!term.current && ' · a term that is not running'}</p>}
    <div className={busy && data ? 'is-loading' : undefined} aria-busy={busy}>
      {stats}
      {data && !term && <Card><Empty title="No term has been set up yet" hint="Add this year’s terms in Settings to see attendance, fees and scores here."><a className="button secondary" href="#/settings/grading">Open settings</a></Empty></Card>}
      <NeedsAttention data={attention}/>
      {data && term && <Panels data={data} pick={classId => change({ classId, level: '' })}/>}
    </div>
    {!data && !error && <p role="status">Loading…</p>}
  </>;
}

// The headteacher's Home: the school at a glance (narrowed by term, level, class and period) and what needs doing today.
export function HeadHome({ schoolId }: { schoolId: string }) {
  const attention = useFollowUp(schoolId);
  const [tab, setTab] = useState<'overview' | 'registers'>('overview');
  return <section aria-label="School overview" className="page">
    {attention.error && <p role="alert">{attention.error}</p>}
    <div className="actions"><Tabs label="Home sections" value={tab} onChange={setTab} options={[{ id: 'overview', label: 'Overview' }, { id: 'registers', label: 'Registers and absences' }]}/></div>
    {tab === 'overview' ? <Dashboard schoolId={schoolId} attention={attention}/> : <RegistersToday schoolId={schoolId} data={attention}/>}
  </section>;
}
