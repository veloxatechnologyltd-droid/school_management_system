import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, Pill, Stat, todayInAccra } from '../lib/ui';

type Round = { key: string; title: string; heldOn: string; subjects: { assessmentId: string; subjectId: string; name: string; maxMark: number }[] };
type Learner = { learnerId: string; fullName: string; rounds: { key: string; average: number | null; subjects: { subjectId: string; name: string; percent: number | null }[]; below: string[]; taken: number }[];
  latest: { key: string; average: number | null; change: number | null; below: string[]; atRisk: boolean } | null };
type Data = { rounds: Round[]; summary: { key: string; average: number | null; sat: number; atRisk: number }[]; learners: Learner[]; riskSubjects: number; passLine: number };
type Roster = { learnerId: string; fullName: string; mark: number | null }[];
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const signed = (n: number | null) => n === null ? '–' : `${n > 0 ? '+' : ''}${n}`;

// Mock exams (e.g. BECE mocks): rounds across all subjects, results entered from one grid, and each learner's readiness.
// Kept apart from class work; nothing here predicts official grades.
// "record" (the Assessment page) adds rounds and enters their results; "view" (the Performance page) shows readiness only.
export function Mocks({ schoolId, csrfToken, classId, termId, subjects, onPlan, mode }: { schoolId: string; csrfToken: string; classId: string; termId: string; subjects: { id: string; name: string }[];
  onPlan?: (learnerId: string, subjectId: string, concern: string) => void; mode: 'record' | 'view' }) {
  const [data, setData] = useState<Data | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false); const [form, setForm] = useState({ title: '', heldOn: todayInAccra(), maxMark: '100', subjectIds: [] as string[] });
  const [entering, setEntering] = useState<Round | null>(null); const [grid, setGrid] = useState<Record<string, Roster>>({}); const [edits, setEdits] = useState<Record<string, string>>({});
  const load = useCallback(async () => { try { setData(await request<Data>(`/schools/${schoolId}/assessment/classes/${classId}/mocks`)); } catch (e) { setError((e as Error).message); } }, [schoolId, classId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const send = (path: string, body: object) => request(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  async function act(work: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }

  const openNew = () => { setForm({ title: `Mock ${(data?.rounds.length ?? 0) + 1}`, heldOn: todayInAccra(), maxMark: '100', subjectIds: subjects.map(s => s.id) }); setCreating(true); };
  const create = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    await send(`/assessment/classes/${classId}/mocks`, { termId, title: form.title, heldOn: form.heldOn, maxMark: Number(form.maxMark), subjectIds: form.subjectIds });
    setCreating(false); await load(); setMessage(`${form.title} added. Enter the results below.`);
  }); };
  // The results grid: one column per subject of the round, filled from what is already recorded.
  const openEntry = (round: Round) => void act(async () => {
    const rosters = await Promise.all(round.subjects.map(s => request<{ items: Roster }>(`/schools/${schoolId}/assessment/classes/${classId}/assessments/${s.assessmentId}/marks`)));
    setGrid(Object.fromEntries(round.subjects.map((s, i) => [s.assessmentId, rosters[i]!.items]))); setEdits({}); setEntering(round);
  });
  const saveEntry = () => void act(async () => {
    if (!entering) return;
    let saved = 0;
    for (const s of entering.subjects) {
      const marks = (grid[s.assessmentId] ?? []).flatMap(r => { const v = edits[`${s.assessmentId}:${r.learnerId}`]; return v !== undefined && v !== '' ? [{ learnerId: r.learnerId, mark: Number(v) }] : []; });
      if (!marks.length) continue;
      await send(`/assessment/classes/${classId}/assessments/${s.assessmentId}/marks`, { marks }); saved += marks.length;
    }
    if (!saved) throw new Error('Enter at least one mark.');
    setEntering(null); await load(); setMessage(`Saved ${saved} result(s) for ${entering.title}.`);
  });

  if (!data) return error ? <p role="alert">{error}</p> : <p className="muted card-body" role="status">Loading…</p>;
  const last = data.summary[data.summary.length - 1], prev = data.summary[data.summary.length - 2];
  const roster = Object.values(grid)[0] ?? [];
  return <>
    {mode === 'record' && <div className="toolbar"><button type="button" className="secondary" disabled={!subjects.length} onClick={openNew}><Icon name="add"/>New mock round</button>
      <span className="count">Kept apart from class work and the CA</span></div>}
    {error && <p role="alert" className="card-body">{error}</p>}{message && <p role="status" className="card-body">{message}</p>}
    {!data.rounds.length ? <Empty title="No mock exams recorded yet" hint={mode === 'record' ? "Add a mock round, then enter each subject's results in one grid." : 'Mock rounds and their results are recorded on the Assessment page.'}/>
    : mode === 'record' ? <div className="table-wrap"><table><thead><tr><th>Mock round</th><th>Date</th><th className="num">Subjects</th><th/></tr></thead><tbody>
      {data.rounds.map(r => <tr key={r.key}><td>{r.title}</td><td>{shortDate(r.heldOn)}</td><td className="num">{r.subjects.length}</td>
        <td><button type="button" className="secondary" disabled={busy} onClick={() => openEntry(r)}>Enter results</button></td></tr>)}</tbody></table></div> : <>
      <div className="stats card-body">
        <Stat label={`${data.rounds[data.rounds.length - 1]!.title} average`} value={last?.average === null || !last ? '–' : `${last.average}%`} caption={prev?.average != null && last?.average != null ? `${signed(Math.round((last.average - prev.average) * 10) / 10)} on the mock before` : `${last?.sat ?? 0} students sat it`} icon="assignment"/>
        <Stat label="Needing support" value={last?.atRisk ?? 0} caption={`${data.riskSubjects}+ subjects below ${data.passLine}% in the latest mock`} icon="flag" tone={last?.atRisk ? 'caution' : 'neutral'}/>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Student</th>{data.rounds.map(r => <th key={r.key} className="num">{r.title}<span className="sub">{shortDate(r.heldOn)}</span></th>)}<th className="num">Change</th><th>Below {data.passLine}% in the latest mock</th></tr></thead><tbody>
        {data.learners.map(l => <tr key={l.learnerId}><td>{l.fullName}{l.latest?.atRisk && <> <Pill tone="caution">Needs support</Pill></>}</td>
          {l.rounds.map(r => <td key={r.key} className="num">{r.average === null ? '–' : `${r.average}%`}</td>)}
          <td className={`num tone-${l.latest?.change == null ? 'neutral' : l.latest.change < 0 ? 'critical' : 'positive'}`}>{signed(l.latest?.change ?? null)}</td>
          <td>{l.latest?.below.length ? <span className="chip-list">{(l.rounds.find(r => r.key === l.latest!.key)?.subjects ?? []).filter(x => x.percent !== null && x.percent < data.passLine).sort((a, b) => a.percent! - b.percent!).map(x => {
            const round = data.rounds.find(r => r.key === l.latest!.key)?.title ?? 'the latest mock';
            return !onPlan ? <span key={x.subjectId}>{x.name} {x.percent}%</span> : <button key={x.subjectId} type="button" className="link-button" onClick={() => onPlan(l.learnerId, x.subjectId, `${x.name}: ${x.percent}% in ${round}, below ${data.passLine}%.`)}>{x.name} {x.percent}%</button>; })}</span> : <span className="muted">None</span>}</td></tr>)}</tbody></table></div>
      <p className="muted card-body">Students are listed weakest first. "Needs support" means {data.riskSubjects} or more subjects below {data.passLine}% in the latest mock; it is a prompt for the school, not a prediction of BECE grades. Select a subject to plan support.</p>
    </>}
    {creating && <Dialog title="New mock round" onClose={() => setCreating(false)}>
      <form onSubmit={create}>
        <div className="field-row"><label>Name<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={2} maxLength={120}/></label>
          <label>Date<input type="date" value={form.heldOn} onChange={e => setForm({ ...form, heldOn: e.target.value })} required/></label>
          <label>Marked out of<input type="number" min={1} max={1000} value={form.maxMark} onChange={e => setForm({ ...form, maxMark: e.target.value })} required/></label></div>
        <fieldset className="indicator-picker"><legend>Subjects ({form.subjectIds.length})</legend><div className="indicator-options">
          {subjects.map(s => <label key={s.id} className="check"><input type="checkbox" checked={form.subjectIds.includes(s.id)} onChange={e => setForm({ ...form, subjectIds: e.target.checked ? [...form.subjectIds, s.id] : form.subjectIds.filter(x => x !== s.id) })}/><span>{s.name}</span></label>)}</div></fieldset>
        <button disabled={busy || !form.subjectIds.length}>Add mock round</button>
      </form>
    </Dialog>}
    {entering && <Dialog title={`${entering.title} results`} wide onClose={() => setEntering(null)}>
      <p className="muted">Marks out of {entering.subjects[0]?.maxMark}. Leave a box empty if the student did not sit that paper.</p>
      <div className="table-wrap"><table className="mock-grid"><thead><tr><th>Student</th>{entering.subjects.map(s => <th key={s.assessmentId}>{s.name}</th>)}</tr></thead><tbody>
        {roster.map(r => <tr key={r.learnerId}><td>{r.fullName}</td>{entering.subjects.map(s => { const key = `${s.assessmentId}:${r.learnerId}`, current = grid[s.assessmentId]?.find(x => x.learnerId === r.learnerId)?.mark;
          return <td key={s.assessmentId}><input type="number" min={0} max={s.maxMark} step="0.5" aria-label={`${r.fullName} ${s.name}`} value={edits[key] ?? (current ?? '')} onChange={e => setEdits({ ...edits, [key]: e.target.value })}/></td>; })}</tr>)}</tbody></table></div>
      <div className="actions"><button disabled={busy} onClick={saveEntry}>Save results</button></div>
    </Dialog>}
  </>;
}
