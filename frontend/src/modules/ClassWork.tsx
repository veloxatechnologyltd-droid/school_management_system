import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Dialog, Empty, Icon, Pill, todayInAccra } from '../lib/ui';

type Page<T> = { items: T[] };
type Subject = { id: string; name: string };
type Assessment = { id: string; subject_id: string; subject_name: string; kind: string; title: string; held_on: string; max_mark: number; marked: number; average: number | null; indicators?: { id: string; code: string | null; description: string }[] };
type Indicator = { id: string; grade: string | null; code: string | null; strand: string | null; sub_strand: string | null; description: string; retired_at: string | null };
type RosterRow = { learnerId: string; fullName: string; left: boolean; mark: number | null };

const kinds = [['classwork', 'Class exercise'], ['homework', 'Homework'], ['quiz', 'Quiz'], ['class_test', 'Class test'], ['project', 'Project']] as const;
export const kindLabel = (kind: string) => kind === 'mock' ? 'Mock exam' : kinds.find(([id]) => id === kind)?.[1] ?? kind;
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const tone = (n: number | null) => n === null ? 'neutral' : n >= 70 ? 'positive' : n >= 50 ? 'caution' : 'critical';
const Score = ({ value }: { value: number | null }) => value === null ? <span className="muted">–</span>
  : <span className="trend-cell"><span className={`trend-value tone-${tone(value)}`}>{value}%</span><span className="trend-bar"><span className={`trend-fill fill-${tone(value)}`} style={{ width: `${Math.min(100, value)}%` }}/></span></span>;

// The term's class exercises, homework, quizzes, class tests and projects for one class, recorded as they happen with
// their marks. These marks make up the continuous assessment.
export function ClassWork({ schoolId, csrfToken, classId, className, termId, subjects, subjectId, onSubject, onChanged }: {
  schoolId: string; csrfToken: string; classId: string; className: string; termId: string; subjects: Subject[]; subjectId: string; onSubject: (id: string) => void; onChanged?: () => void }) {
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [creating, setCreating] = useState(false); const [form, setForm] = useState({ subjectId: '', kind: 'classwork', title: '', heldOn: todayInAccra(), maxMark: '20' });
  const [indicators, setIndicators] = useState<Indicator[]>([]); const [allGrades, setAllGrades] = useState(false); const [chosen, setChosen] = useState<string[]>([]); const [indicatorSearch, setIndicatorSearch] = useState('');
  const [marking, setMarking] = useState<{ assessment: Assessment; items: RosterRow[] } | null>(null); const [marks, setMarks] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const send = <T,>(path: string, body: object) => request<T>(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });

  // Only the latest request may fill the list, so a quick change of class never shows another class's work.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const current = ++latest.current; setAssessments(null);
    try { const r = await request<Page<Assessment>>(`/schools/${schoolId}/assessment/classes/${classId}/assessments?termId=${termId}${subjectId ? `&subjectId=${subjectId}` : ''}`);
      if (current === latest.current) setAssessments(r.items.filter(a => a.kind !== 'mock')); }
    catch (e) { if (current === latest.current) setError((e as Error).message); }
  }, [schoolId, classId, termId, subjectId]);
  useEffect(() => { void load(); }, [load]);

  // Current indicators of the subject chosen in the new-work dialog.
  useEffect(() => { setIndicators([]); setChosen([]); setIndicatorSearch('');
    if (!creating || !form.subjectId) return;
    let live = true;
    request<Page<Indicator>>(`/schools/${schoolId}/assessment/indicators?subjectId=${form.subjectId}`).then(r => { if (live) setIndicators(r.items.filter(i => !i.retired_at)); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; }; }, [schoolId, creating, form.subjectId]);
  // Indicators for this class's grade (named like the class, e.g. "Basic 5" for "Basic 5 Blue") and ones with no grade come first;
  // other grades stay one tick away.
  const ownGrade = (i: Indicator) => !i.grade || className.toLowerCase() === i.grade.toLowerCase() || className.toLowerCase().startsWith(`${i.grade.toLowerCase()} `);
  const otherGrades = indicators.filter(i => !ownGrade(i)).length;
  const pickable = allGrades ? [...indicators].sort((a, b) => Number(ownGrade(b)) - Number(ownGrade(a))) : indicators.filter(ownGrade);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const create = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    const a = await send<Assessment>(`/assessment/classes/${classId}/assessments`, { termId, subjectId: form.subjectId, kind: form.kind, title: form.title, heldOn: form.heldOn, maxMark: Number(form.maxMark), ...(chosen.length ? { indicatorIds: chosen } : {}) });
    setCreating(false); setForm({ ...form, title: '' }); await load(); onChanged?.();
    await openMarks({ ...a, subject_id: form.subjectId, subject_name: subjects.find(s => s.id === form.subjectId)?.name ?? '', marked: 0, average: null });
  }); };
  const openMarks = async (assessment: Assessment) => {
    const r = await request<{ items: RosterRow[] }>(`/schools/${schoolId}/assessment/classes/${classId}/assessments/${assessment.id}/marks`);
    setMarks({}); setMarking({ assessment, items: r.items });
  };
  const saveMarks = () => void act(async () => {
    if (!marking) return;
    const items = marking.items.flatMap(row => marks[row.learnerId] !== undefined && marks[row.learnerId] !== '' ? [{ learnerId: row.learnerId, mark: Number(marks[row.learnerId]) }] : []);
    if (!items.length) throw new Error('Enter at least one mark.');
    const r = await send<{ written: number }>(`/assessment/classes/${classId}/assessments/${marking.assessment.id}/marks`, { marks: items });
    setMarking(null); await load(); onChanged?.(); setMessage(`Saved ${r.written} mark(s) for ${marking.assessment.title}.`);
  });

  return <>
    <div className="toolbar"><label>Subject<select value={subjectId} onChange={e => onSubject(e.target.value)}><option value="">All subjects</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <span className="count">{assessments ? `${assessments.length} this term` : ''}</span>
      <button type="button" disabled={!subjects.length} onClick={() => { setForm(f => ({ ...f, subjectId: f.subjectId || subjectId || subjects[0]?.id || '' })); setCreating(true); }}><Icon name="add"/>Add class work</button></div>
    {error && <p role="alert" className="card-body">{error}</p>}{message && <p role="status" className="card-body">{message}</p>}
    {!assessments ? !error && <p className="muted card-body" role="status">Loading…</p>
      : !assessments.length ? <Empty title="No class work recorded yet" hint="Add each class exercise, homework or class test with its date, then enter the marks. The continuous assessment is worked out from them."/>
      : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Class work</th><th className="hide-sm">Subject</th><th className="num">Marked</th><th className="hide-sm">Class average</th><th/></tr></thead><tbody>
        {assessments.map(a => <tr key={a.id}><td>{shortDate(a.held_on)}</td><td>{a.title}<span className="sub">{kindLabel(a.kind)} · out of {a.max_mark}{a.indicators?.length ? ` · ${a.indicators.map(i => i.code ?? i.description).join(', ')}` : ''}</span><span className="sub show-sm">{a.subject_name}{a.average !== null ? ` · class average ${a.average}%` : ''}</span></td><td className="hide-sm">{a.subject_name}</td><td className="num">{a.marked}</td><td className="hide-sm"><Score value={a.average}/></td>
          <td><button type="button" className="secondary" disabled={busy} onClick={() => void act(() => openMarks(a))}>Enter marks</button></td></tr>)}</tbody></table></div>}
    {creating && <Dialog title="Add class work" onClose={() => setCreating(false)}>
      <form onSubmit={create}>
        <label>Subject<select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })} required><option value="">Choose a subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Type<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={2} maxLength={120} placeholder="e.g. Fractions exercise 3"/></label>
        <label>Date<input type="date" value={form.heldOn} onChange={e => setForm({ ...form, heldOn: e.target.value })} required/></label>
        <label>Marked out of<input type="number" min={1} max={1000} step="0.5" value={form.maxMark} onChange={e => setForm({ ...form, maxMark: e.target.value })} required/></label>
        {indicators.length > 0 && <fieldset className="indicator-picker"><legend>Curriculum indicators tested (optional)</legend>
          {otherGrades > 0 && <label className="check"><input type="checkbox" checked={allGrades} onChange={e => setAllGrades(e.target.checked)}/><span>Show other grades too ({otherGrades} more)</span></label>}
          {pickable.length > 8 && <input type="search" aria-label="Search indicators" placeholder="Search by code or words" value={indicatorSearch} onChange={e => setIndicatorSearch(e.target.value)}/>}
          <div className="indicator-options">{pickable.filter(i => !indicatorSearch || `${i.code ?? ''} ${i.description} ${i.strand ?? ''} ${i.sub_strand ?? ''}`.toLowerCase().includes(indicatorSearch.toLowerCase())).slice(0, 40).map(i =>
            <label key={i.id} className="check"><input type="checkbox" checked={chosen.includes(i.id)} disabled={!chosen.includes(i.id) && chosen.length >= 10} onChange={e => setChosen(e.target.checked ? [...chosen, i.id] : chosen.filter(id => id !== i.id))}/><span>{i.code && <strong>{i.code} </strong>}{i.description}</span></label>)}</div>
          {chosen.length > 0 && <p className="muted">{chosen.length} chosen</p>}</fieldset>}
        <button disabled={busy}>Add and enter marks</button>
      </form>
    </Dialog>}
    {marking && <Dialog title={`${marking.assessment.title} · out of ${marking.assessment.max_mark}`} onClose={() => setMarking(null)}>
      <p className="muted">{marking.assessment.subject_name} · {kindLabel(marking.assessment.kind)} · {shortDate(marking.assessment.held_on)}. Leave a box empty if the learner did not take it.</p>
      <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Mark</th></tr></thead><tbody>{marking.items.map(row => <tr key={row.learnerId}><td>{row.fullName}{row.left && <> <Pill>left</Pill></>}</td>
        <td><input type="number" min={0} max={marking.assessment.max_mark} step="0.5" aria-label={`${row.fullName} mark`} value={marks[row.learnerId] ?? (row.mark ?? '')} onChange={e => setMarks({ ...marks, [row.learnerId]: e.target.value })}/></td></tr>)}</tbody></table></div>
      <div className="actions"><button disabled={busy} onClick={saveMarks}>Save marks</button></div>
    </Dialog>}
  </>;
}
