import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { currentTerm } from '../lib/ui';

type Page<T> = { items: T[] };
type Subject = { id: string; name: string };
type Term = { id: string; name: string; year_name: string; start_date: string; end_date: string };
type ClassOption = { id: string; name: string; level: string; year_name: string };
type Year = { id: string; name: string };
type Band = { min: number; grade: string; remark: string };
type Policy = { ca_weight: number; exam_weight: number; bands: Band[]; source_note: string; version: number } | null;
type GridRow = { learnerId: string; fullName: string; admissionNumber: string; ca: number | null; exam: number | null; locked: boolean; published: boolean };
type Result = { learnerId: string; fullName: string; complete: boolean; average: number | null; position: number | null; subjects: { name: string; total: number | null; grade: string | null }[] };

const bandsToText = (bands: Band[]) => bands.map(b => `${b.min},${b.grade},${b.remark}`).join('\n');
function parseBands(text: string): Band[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const [min, grade, ...remark] = line.split(','); return { min: Number(min), grade: (grade ?? '').trim(), remark: remark.join(',').trim() }; });
}

// Settings shows the setup forms directly; elsewhere they sit in a collapsible block.
const SetupWrap = ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : <details><summary>Setup: subjects, terms and grading policy</summary>{children}</details>;
export function Assessment({ schoolId, csrfToken, role, view }: { schoolId: string; csrfToken: string; role: string; view?: 'setup' | 'work' }) {
  const head = role === 'headteacher';
  const headers = { 'x-csrf-token': csrfToken };
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [policy, setPolicy] = useState<Policy>(null);
  const [classId, setClassId] = useState(''); const [termId, setTermId] = useState(''); const [subjectId, setSubjectId] = useState('');
  const [grid, setGrid] = useState<GridRow[]>([]); const [edits, setEdits] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [newSubject, setNewSubject] = useState(''); const [newTerm, setNewTerm] = useState({ academicYearId: '', name: '', startDate: '', endDate: '' });
  const [policyForm, setPolicyForm] = useState({ caWeight: '30', examWeight: '70', bands: '80,A,Excellent\n65,B,Good\n50,C,Credit\n0,D,Needs support', sourceNote: '' });

  const loadSetup = useCallback(async () => {
    try {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
      const [s, t, p, c] = await Promise.all([
        request<Page<Subject>>(`/schools/${schoolId}/assessment/subjects`), request<Page<Term>>(`/schools/${schoolId}/assessment/terms`),
        request<{ policy: Policy }>(`/schools/${schoolId}/assessment/policy`),
        request<Page<ClassOption>>(head ? `/schools/${schoolId}/teaching/class-options?limit=100` : `/schools/${schoolId}/teaching/classes?date=${today}&limit=100`),
      ]);
      setSubjects(s.items); setTerms(t.items); setPolicy(p.policy); setClasses(c.items);
      // Open on something to look at: the first class and subject in the current term.
      setClassId(prior => prior || c.items[0]?.id || ''); setTermId(prior => prior || currentTerm(t.items)?.id || ''); setSubjectId(prior => prior || s.items[0]?.id || '');
      if (p.policy) setPolicyForm({ caWeight: String(p.policy.ca_weight), examWeight: String(p.policy.exam_weight), bands: bandsToText(p.policy.bands), sourceNote: p.policy.source_note });
      if (head) setYears((await request<{ items: Year[] }>(`/schools/${schoolId}/academic-years?limit=100`)).items);
    } catch (e) { setError((e as Error).message); }
  }, [schoolId, head]);
  useEffect(() => { void loadSetup(); }, [loadSetup]);

  const loadGrid = useCallback(async () => {
    setGrid([]); setEdits({}); setResults([]);
    if (!classId || !termId) return;
    try { setGrid((await request<{ items: GridRow[] }>(`/schools/${schoolId}/assessment/classes/${classId}/grid?termId=${termId}${subjectId ? `&subjectId=${subjectId}` : ''}`)).items); }
    catch (e) { setError((e as Error).message); }
  }, [schoolId, classId, termId, subjectId]);
  useEffect(() => { void loadGrid(); }, [loadGrid]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const send = <T,>(path: string, method: string, body: object) => request<T>(`/schools/${schoolId}${path}`, { method, headers, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  const addSubject = (e: FormEvent) => { e.preventDefault(); void act(async () => { await send('/assessment/subjects', 'POST', { name: newSubject }); setNewSubject(''); await loadSetup(); setMessage('Subject added.'); }); };
  const addTerm = (e: FormEvent) => { e.preventDefault(); void act(async () => { await send('/assessment/terms', 'POST', newTerm); setNewTerm({ academicYearId: '', name: '', startDate: '', endDate: '' }); await loadSetup(); setMessage('Term added.'); }); };
  const savePolicy = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    await send('/assessment/policy', 'PUT', { caWeight: Number(policyForm.caWeight), examWeight: Number(policyForm.examWeight), bands: parseBands(policyForm.bands), sourceNote: policyForm.sourceNote, ...(policy ? { version: policy.version } : {}) });
    await loadSetup(); setMessage('Assessment policy saved.');
  }); };
  const saveScores = () => void act(async () => {
    if (!subjectId) throw new Error('Choose a subject first.');
    const scores = grid.flatMap(row => (['ca', 'exam'] as const).flatMap(kind => { const key = `${row.learnerId}:${kind}`; return edits[key] !== undefined && edits[key] !== '' ? [{ learnerId: row.learnerId, kind, score: Number(edits[key]) }] : []; }));
    if (!scores.length) throw new Error('Enter at least one score.');
    const result = await send<{ written: number }>(`/assessment/classes/${classId}/scores`, 'POST', { termId, subjectId, scores });
    await loadGrid(); setMessage(`Saved ${result.written} score(s).`);
  });
  const reopen = (row: GridRow) => { const reason = window.prompt(`Why is ${row.fullName}'s published report being corrected? This is recorded.`); if (!reason || reason.trim().length < 3) return;
    void act(async () => { await send(`/assessment/classes/${classId}/reopen`, 'POST', { termId, learnerId: row.learnerId, reason }); await loadGrid(); setMessage(`${row.fullName}'s report is open for correction. Fix the scores, then publish the corrected report.`); }); };
  const reissue = (row: GridRow) => void act(async () => { const r = await send<{ revision: number }>(`/assessment/classes/${classId}/reissue`, 'POST', { termId, learnerId: row.learnerId, acknowledgeIncomplete: false }); await loadGrid(); setMessage(`Corrected report published (revision ${r.revision}).`); });
  const preview = () => void act(async () => { setResults((await request<{ items: Result[] }>(`/schools/${schoolId}/assessment/classes/${classId}/results?termId=${termId}`)).items); });
  const publish = () => { if (!window.confirm('Publish terminal reports for this class? Scores will be locked and guardians can see them.')) return;
    void act(async () => {
      const incomplete = results.filter(r => !r.complete).length;
      if (incomplete && !window.confirm(`${incomplete} learner(s) have missing scores. Publish their incomplete reports anyway?`)) return;
      const r = await send<{ published: number }>(`/assessment/classes/${classId}/publish`, 'POST', { termId, acknowledgeIncomplete: incomplete > 0 });
      await loadGrid(); setMessage(`Published ${r.published} report(s).`);
    }); };

  return <section aria-label="Assessment and terminal reports">
    <h2>{view === 'setup' ? 'Subjects, terms and grading' : 'Assessment and terminal reports'}</h2>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {head && view !== 'work' && <SetupWrap open={view === 'setup'}>
      <form onSubmit={addSubject}><label>New subject<input value={newSubject} onChange={e => setNewSubject(e.target.value)} required minLength={2} maxLength={80}/></label><button disabled={busy}>Add subject</button></form>
      <p className="muted">Subjects: {subjects.map(s => s.name).join(', ') || 'none yet'}</p>
      <form onSubmit={addTerm}><label>Year for this term<select value={newTerm.academicYearId} onChange={e => setNewTerm({ ...newTerm, academicYearId: e.target.value })} required><option value="">Choose a year</option>{years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
        <label>Term name<input value={newTerm.name} onChange={e => setNewTerm({ ...newTerm, name: e.target.value })} required placeholder="Term 1"/></label>
        <label>Term start date<input type="date" value={newTerm.startDate} onChange={e => setNewTerm({ ...newTerm, startDate: e.target.value })} required/></label>
        <label>Term end date<input type="date" value={newTerm.endDate} onChange={e => setNewTerm({ ...newTerm, endDate: e.target.value })} required/></label><button disabled={busy}>Add term</button></form>
      <form onSubmit={savePolicy}><h3>Grading policy (set from your school's own policy)</h3>
        <label>Continuous assessment weight (%)<input type="number" min={0} max={100} value={policyForm.caWeight} onChange={e => setPolicyForm({ ...policyForm, caWeight: e.target.value, examWeight: String(100 - Number(e.target.value)) })} required/></label>
        <label>Exam weight (%)<input type="number" value={policyForm.examWeight} readOnly/></label>
        <label>Grade bands (one per line: minimum score, grade, remark)<textarea value={policyForm.bands} onChange={e => setPolicyForm({ ...policyForm, bands: e.target.value })} required/></label>
        <label>Where this policy comes from<input value={policyForm.sourceNote} onChange={e => setPolicyForm({ ...policyForm, sourceNote: e.target.value })} required minLength={3} placeholder="e.g. School policy memo, September 2026"/></label><button disabled={busy}>Save policy</button></form></SetupWrap>}
    {view !== 'setup' && <>{!policy && <p className="muted">{head ? 'Set the grading policy above before scores can be recorded.' : 'The headteacher has not set the grading policy yet.'}</p>}
    <label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
    <label>Term<select value={termId} onChange={e => setTermId(e.target.value)}><option value="">Choose a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>
    <label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">Choose a subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {grid.length > 0 && <><table><thead><tr><th>Learner</th><th>Continuous assessment (0–100)</th><th>Exam (0–100)</th>{head && <th>Published report</th>}</tr></thead><tbody>
      {grid.map(row => <tr key={row.learnerId}><td>{row.fullName}</td>{(['ca', 'exam'] as const).map(kind => <td key={kind}><input type="number" min={0} max={100} step="0.01" aria-label={`${row.fullName} ${kind === 'ca' ? 'continuous assessment' : 'exam'}`} disabled={row.locked}
        value={edits[`${row.learnerId}:${kind}`] ?? (row[kind] ?? '')} onChange={e => setEdits({ ...edits, [`${row.learnerId}:${kind}`]: e.target.value })}/></td>)}{head && <td>{row.locked ? <button type="button" className="secondary" disabled={busy} onClick={() => reopen(row)}>Correct this report</button> : row.published ? <button type="button" disabled={busy} onClick={() => reissue(row)}>Publish corrected report</button> : '–'}</td>}</tr>)}</tbody></table>
      <div className="actions"><button disabled={busy || !policy} onClick={saveScores}>Save scores</button>{head && <button className="secondary" disabled={busy} onClick={preview}>Preview results</button>}</div></>}
    {results.length > 0 && <><h3>Results preview</h3><ul className="history">{results.map(r => <li key={r.learnerId}><strong>{r.fullName}{r.position ? ` · position ${r.position}` : ''}</strong><span>{r.complete ? `Average ${r.average}` : 'Missing scores'} · {r.subjects.map(s => `${s.name}: ${s.total ?? '–'}${s.grade ? ` (${s.grade})` : ''}`).join(' · ')}</span></li>)}</ul>
      <button disabled={busy} onClick={publish}>Publish terminal reports</button></>}
    </>}
  </section>;
}

type Snapshot = { term: { name: string }; class: { name: string }; classSize: number; average: number | null; position: number | null; complete: boolean; policy: { caWeight: number; examWeight: number; sourceNote: string };
  subjects: { name: string; ca: number | null; exam: number | null; total: number | null; grade: string | null; remark: string | null }[] };
export function GuardianTerminalReports({ schoolId }: { schoolId: string }) {
  const [children, setChildren] = useState<{ id: string; full_name: string; academic: boolean }[]>([]);
  const [childId, setChildId] = useState('');
  const [reports, setReports] = useState<{ id: string; snapshot: Snapshot; published_at: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { request<{ id: string; full_name: string; academic: boolean }[]>(`/schools/${schoolId}/guardian/children`).then(rows => { const academic = rows.filter(r => r.academic); setChildren(academic); setChildId(prior => prior || academic[0]?.id || ''); }).catch(e => setError((e as Error).message)); }, [schoolId]);
  useEffect(() => { setReports([]); if (!childId) return; request<{ items: typeof reports }>(`/schools/${schoolId}/guardian/children/${childId}/terminal-reports`).then(r => setReports(r.items)).catch(e => setError((e as Error).message)); }, [schoolId, childId]);
  return <section aria-label="Terminal reports">
    <h2>Terminal reports</h2>{error && <p role="alert">{error}</p>}
    <label>Child<select value={childId} onChange={e => setChildId(e.target.value)}><option value="">Choose a child</option>{children.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>
    {childId && !reports.length && <p>No published terminal reports yet.</p>}
    {reports.map(r => <article key={r.id}><h3>{r.snapshot.term.name} · {r.snapshot.class.name}</h3>
      <table><thead><tr><th>Subject</th><th>Class work</th><th>Exam</th><th>Total</th><th>Grade</th></tr></thead><tbody>{r.snapshot.subjects.map(s => <tr key={s.name}><td>{s.name}</td><td>{s.ca ?? '–'}</td><td>{s.exam ?? '–'}</td><td>{s.total ?? '–'}</td><td>{s.grade ?? '–'}{s.remark ? ` · ${s.remark}` : ''}</td></tr>)}</tbody></table>
      <p>{r.snapshot.complete ? `Average ${r.snapshot.average} · position ${r.snapshot.position} of ${r.snapshot.classSize}` : 'Some scores were not available when this report was published.'}</p>
      <p className="muted">Weighting: {r.snapshot.policy.caWeight}% class work, {r.snapshot.policy.examWeight}% exam. Source: {r.snapshot.policy.sourceNote}</p></article>)}
  </section>;
}
