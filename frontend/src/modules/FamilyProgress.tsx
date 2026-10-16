import React, { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Pill, Tone } from '../lib/ui';

type Progress = { shared: boolean; termResults: { terms: { termId: string; label: string; average: number | null }[]; subjects: { name: string; points: { termId: string; total: number | null }[] }[] };
  months?: string[]; subjects?: { name: string; status: 'improving' | 'steady' | 'needs_attention' | 'not_enough'; months: { month: string; average: number | null }[] }[];
  help?: { subject: string; topic: string | null; note: string; teacher: string; practice: { kind: string; title: string; detail: string | null; url: string | null }[] }[] };
const status: Record<string, [string, Tone]> = { improving: ['Improving', 'positive'], steady: ['Steady', 'info'], needs_attention: ['Needs attention', 'caution'], not_enough: ['Not enough marks yet', 'neutral'] };
const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' });
const pct = (n: number | null) => n === null ? '–' : `${n}%`;

// A child's progress for their family. "help" is what teachers suggest at home (shown on the family's Home page);
// "tables" is how each subject is going and how terms compare (the Progress page).
export function FamilyProgress({ schoolId, childId, view }: { schoolId: string; childId: string; view: 'help' | 'tables' }) {
  const [data, setData] = useState<Progress | null>(null); const [error, setError] = useState('');
  useEffect(() => { let live = true; setData(null); setError('');
    request<Progress>(`/schools/${schoolId}/guardian/children/${childId}/progress`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; }; }, [schoolId, childId]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  const tr = data.termResults, subjects = data.subjects ?? [], help = data.help ?? [];
  // Term results compare terms; with one term the report card already says it all.
  const compare = tr.terms.length >= 2;
  if (view === 'help') return <section aria-label="Help at home" className="page"><Card title="How you can help at home" hint="From your child's teachers. Ask them if anything is unclear.">
    {!help.length ? <Empty title="Nothing from the teachers yet" hint="When a teacher has something to try at home, it appears here."/>
      : <ul className="help-list">{help.map((h, i) => <li key={i}><strong>{h.subject}{h.topic ? `: ${h.topic}` : ''}</strong><p>{h.note}</p>
        {h.practice.length > 0 && <ul className="practice-list">{h.practice.map((r, j) => <li key={j}><span>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : <strong>{r.title}</strong>}{r.detail && <span className="sub">{r.detail}</span>}</span></li>)}</ul>}
        <span className="muted">From {h.teacher}</span></li>)}</ul>}
  </Card></section>;
  return <section aria-label="Progress" className="page">
    {!subjects.length && !compare && <Card>{data.shared
      ? <Empty title="No marks to show yet" hint="Once class exercises, homework and tests are marked, how each subject is going appears here."/>
      : <Empty title="Class progress is not shared yet" hint="The school has not switched on sharing of class progress with families. Published report cards are on the Report cards page."/>}</Card>}
    {subjects.length > 0 && <Card title="How each subject is going" hint="From class exercises, homework and tests this term. Monthly averages are percentages." flush>
      <div className="table-wrap"><table><thead><tr><th>Subject</th><th>This term</th>{data.months!.map(m => <th key={m} className="num">{monthName(m)}</th>)}</tr></thead><tbody>
        {subjects.map(s => <tr key={s.name}><td>{s.name}</td><td><Pill tone={status[s.status]![1]}>{status[s.status]![0]}</Pill></td>{s.months.map(m => <td key={m.month} className="num">{pct(m.average)}</td>)}</tr>)}</tbody></table></div>
    </Card>}
    {compare && <Card title="Term results" hint="From published report cards: each subject's total, term by term." flush>
      <div className="table-wrap"><table><thead><tr><th>Subject</th>{tr.terms.map(t => <th key={t.termId} className="num">{t.label}</th>)}</tr></thead><tbody>
        {tr.subjects.map(s => <tr key={s.name}><td>{s.name}</td>{s.points.map(p => <td key={p.termId} className="num">{p.total ?? '–'}</td>)}</tr>)}
        <tr className="trend-total"><td>Average</td>{tr.terms.map(t => <td key={t.termId} className="num">{t.average ?? '–'}</td>)}</tr></tbody></table></div>
    </Card>}
  </section>;
}
