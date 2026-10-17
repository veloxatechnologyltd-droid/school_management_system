import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, Pill, Tabs, currentTerm } from '../lib/ui';
import { caPartLabels, distribute, type CaPartValues } from '../lib/caParts';
import { dayLabel } from '../lib/dates';
import { CaSheet, WorkSet } from './CaSheet';
import { ClassWork } from './ClassWork';
import { Mocks } from './Mocks';

type Page<T> = { items: T[] };
type Subject = { id: string; name: string };
type Term = { id: string; name: string; year_name: string; start_date: string; end_date: string };
type ClassOption = { id: string; name: string; level: string; year_name: string };
type Year = { id: string; name: string };
type Band = { min: number; grade: string; remark: string };
type CaParts = { exercises: number; homework: number; tests: number; projects: number };
type Policy = { ca_weight: number; exam_weight: number; ca_parts: CaParts; bands: Band[]; source_note: string; version: number } | null;

type GridRow = { learnerId: string; fullName: string; admissionNumber: string; ca: number | null; exam: number | null; locked: boolean; published: boolean };
type Result = { learnerId: string; fullName: string; complete: boolean; average: number | null; position: number | null; subjects: { name: string; total: number | null; grade: string | null }[] };
type Remark = { learnerId: string; fullName: string; locked: boolean; conduct: string | null; attitude: string | null; interest: string | null; teacherRemark: string | null; headRemark: string | null };
const remarkFields = [['conduct', 'Conduct'], ['attitude', 'Attitude'], ['interest', 'Interest'], ['teacherRemark', "Class teacher's remark"], ['headRemark', "Headteacher's remark"]] as const;

// Stored parts are shares of the CA out of 100; the form shows them as points of the final score (15 + 15 + 20 under a CA of 50).
const partsAsPoints = (shares: CaParts, caWeight: number) => Object.fromEntries(Object.entries(distribute(shares, caWeight, 1)).map(([key, value]) => [key, String(value)])) as Record<keyof CaParts, string>;
const bandsToText = (bands: Band[]) => bands.map(b => `${b.min},${b.grade},${b.remark}`).join('\n');
function parseBands(text: string): Band[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const [min, grade, ...remark] = line.split(','); return { min: Number(min), grade: (grade ?? '').trim(), remark: remark.join(',').trim() }; });
}

// Settings shows the setup forms directly; elsewhere they sit in a collapsible block.
const SetupWrap = ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : <details><summary>Setup: subjects, terms and grading policy</summary>{children}</details>;
export function Assessment({ schoolId, csrfToken, role, view }: { schoolId: string; csrfToken: string; role: string; view?: 'setup' | 'work' }) {
  const head = role === 'headteacher';
  const headers = { 'x-csrf-token': csrfToken };
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [policy, setPolicy] = useState<Policy>(null);
  const [classId, setClassId] = useState(''); const [termId, setTermId] = useState(''); const [subjectId, setSubjectId] = useState('');
  // Class work opens on every subject, and the CA sheet on the first subject with work, until a subject is picked there.
  const [workSubject, setWorkSubject] = useState('');
  const [grid, setGrid] = useState<GridRow[]>([]); const [edits, setEdits] = useState<Record<string, string>>({});
  // Each learner's CA as worked out from this term's class work in the subject (null where nothing is marked yet).
  const [classCa, setClassCa] = useState<Record<string, { ca: number | null; assessments: number }> | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [remarks, setRemarks] = useState<Remark[]>([]); const [remarkEdits, setRemarkEdits] = useState<Record<string, string>>({});
  const [remarkRun, setRemarkRun] = useState<{ runId: string; drafts: Record<string, string> } | null>(null); const [remarkNote, setRemarkNote] = useState('');
  const [printing, setPrinting] = useState<{ id: string; snapshot: Snapshot }[] | null>(null);
  const [printLevel, setPrintLevel] = useState('');
  const [tab, setTab] = useState<'work' | 'ca' | 'scores' | 'mocks' | 'remarks' | 'reports'>('work');
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [newSubject, setNewSubject] = useState(''); const [newTerm, setNewTerm] = useState({ academicYearId: '', name: '', startDate: '', endDate: '' });
  const [policyForm, setPolicyForm] = useState({ caWeight: '50', examWeight: '50', bands: '80,A,Excellent\n65,B,Good\n50,C,Credit\n0,D,Needs support', sourceNote: '', parts: { exercises: '15', homework: '15', tests: '20', projects: '0' } as Record<keyof CaParts, string> });

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
      if (p.policy) { const parts = p.policy.ca_parts; setPolicyForm({ caWeight: String(p.policy.ca_weight), examWeight: String(p.policy.exam_weight), bands: bandsToText(p.policy.bands), sourceNote: p.policy.source_note, parts: partsAsPoints(parts, p.policy.ca_weight) }); }
      if (head) setYears((await request<{ items: Year[] }>(`/schools/${schoolId}/academic-years?limit=100`)).items);
    } catch (e) { setError((e as Error).message); }
  }, [schoolId, head]);
  useEffect(() => { void loadSetup(); }, [loadSetup]);

  const loadGrid = useCallback(async () => {
    setGrid([]); setEdits({}); setResults([]); setClassCa(null);
    if (!classId || !termId) return;
    try {
      const [g, c] = await Promise.all([request<{ items: GridRow[] }>(`/schools/${schoolId}/assessment/classes/${classId}/grid?termId=${termId}${subjectId ? `&subjectId=${subjectId}` : ''}`),
        subjectId ? request<{ items: { learnerId: string; ca: number | null; assessments: number }[] }>(`/schools/${schoolId}/assessment/classes/${classId}/ca-suggestion?termId=${termId}&subjectId=${subjectId}`) : Promise.resolve({ items: [] })]);
      setGrid(g.items); setClassCa(Object.fromEntries(c.items.map(i => [i.learnerId, { ca: i.ca, assessments: i.assessments }])));
    } catch (e) { setError((e as Error).message); }
  }, [schoolId, classId, termId, subjectId]);
  useEffect(() => { void loadGrid(); }, [loadGrid]);
  // Only the latest request may fill the table, so a quick change of class never shows another class's learners.
  const remarksRequest = useRef(0);
  const loadRemarks = useCallback(async () => {
    const current = ++remarksRequest.current;
    setRemarks([]); setRemarkEdits({}); setRemarkRun(null); setRemarkNote('');
    if (!classId || !termId || view === 'setup') return;
    try { const items = (await request<{ items: Remark[] }>(`/schools/${schoolId}/assessment/classes/${classId}/remarks?termId=${termId}`)).items; if (current === remarksRequest.current) setRemarks(items); }
    catch (e) { if (current === remarksRequest.current) setError((e as Error).message); }
  }, [schoolId, classId, termId, view]);
  useEffect(() => { void loadRemarks(); }, [loadRemarks]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const send = <T,>(path: string, method: string, body: object) => request<T>(`/schools/${schoolId}${path}`, { method, headers, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  const addSubject = (e: FormEvent) => { e.preventDefault(); void act(async () => { await send('/assessment/subjects', 'POST', { name: newSubject }); setNewSubject(''); await loadSetup(); setMessage('Subject added.'); }); };
  const addTerm = (e: FormEvent) => { e.preventDefault(); void act(async () => { await send('/assessment/terms', 'POST', newTerm); setNewTerm({ academicYearId: '', name: '', startDate: '', endDate: '' }); await loadSetup(); setMessage('Term added.'); }); };
  const caWeightNow = Number(policyForm.caWeight) || 0, examWeightNow = 100 - caWeightNow;
  const partPoints = Object.fromEntries(Object.entries(policyForm.parts).map(([k, v]) => [k, Number(v) || 0])) as CaPartValues;
  const partsTotal = Math.round(Object.values(partPoints).reduce((sum, v) => sum + v, 0) * 10) / 10;
  // Changing the CA weight keeps the parts in the same proportion (a CA of 50 with 15/15/20 becomes 9/9/12 at 30).
  const changeCaWeight = (value: string) => { const next = Number(value) || 0;
    const parts = partsTotal > 0 && next > 0 ? partsAsPoints(distribute(partPoints, 100, 4), next) : policyForm.parts;
    setPolicyForm({ ...policyForm, caWeight: value, examWeight: String(100 - next), parts }); };
  const savePolicy = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    if (caWeightNow > 0 && partsTotal !== caWeightNow) throw new Error(`The parts of the continuous assessment add up to ${partsTotal}, but it counts for ${caWeightNow}. Make them add up to ${caWeightNow}.`);
    const caParts = caWeightNow > 0 ? distribute(partPoints, 100, 4) : undefined;
    await send('/assessment/policy', 'PUT', { caWeight: caWeightNow, examWeight: examWeightNow, bands: parseBands(policyForm.bands), ...(caParts ? { caParts } : {}), sourceNote: policyForm.sourceNote, ...(policy ? { version: policy.version } : {}) });
    await loadSetup(); setMessage('Assessment policy saved.');
  }); };
  // The CA is never typed: it comes from the learner's class work this term, weighted by the school's parts. Saving stores
  // the exam marks entered and, for every open report, the CA from class work where it differs from what was saved.
  const caFor = (row: GridRow) => row.locked ? row.ca : classCa?.[row.learnerId]?.ca ?? row.ca;
  const saveScores = () => void act(async () => {
    if (!subjectId) throw new Error('Choose a subject first.');
    const exams = grid.flatMap(row => { const v = edits[`${row.learnerId}:exam`]; return !row.locked && v !== undefined && v !== '' && Number(v) !== row.exam ? [{ learnerId: row.learnerId, kind: 'exam' as const, score: Number(v) }] : []; });
    const cas = grid.flatMap(row => { const ca = classCa?.[row.learnerId]?.ca; return !row.locked && ca != null && ca !== row.ca ? [{ learnerId: row.learnerId, kind: 'ca' as const, score: ca }] : []; });
    if (!exams.length && !cas.length) throw new Error('Nothing to save: enter an exam mark, or record class work marks first.');
    const result = await send<{ written: number }>(`/assessment/classes/${classId}/scores`, 'POST', { termId, subjectId, scores: [...cas, ...exams] });
    await loadGrid(); setMessage(`Saved ${exams.length} exam mark(s)${cas.length ? ` and the CA from class work for ${cas.length} learner(s)` : ''} (${result.written} score(s) written).`);
  });
  const reopen = (row: GridRow) => { const reason = window.prompt(`Why is ${row.fullName}'s published report being corrected? This is recorded.`); if (!reason || reason.trim().length < 3) return;
    void act(async () => { await send(`/assessment/classes/${classId}/reopen`, 'POST', { termId, learnerId: row.learnerId, reason }); await loadGrid(); setMessage(`${row.fullName}'s report is open for correction. Fix the scores, then publish the corrected report.`); }); };
  const reissue = (row: GridRow) => void act(async () => { const r = await send<{ revision: number }>(`/assessment/classes/${classId}/reissue`, 'POST', { termId, learnerId: row.learnerId, acknowledgeIncomplete: false }); await loadGrid(); setMessage(`Corrected report published (revision ${r.revision}).`); });
  // The class teacher's fields and the head's remark are saved as separate authors; only changed rows are sent.
  const saveRemarks = () => void act(async () => {
    const value = (row: Remark, field: typeof remarkFields[number][0]) => (remarkEdits[`${row.learnerId}:${field}`] ?? row[field] ?? '').trim() || undefined;
    const changed = (row: Remark, fields: readonly string[]) => fields.some(field => remarkEdits[`${row.learnerId}:${field}`] !== undefined);
    const teacherFields = ['conduct', 'attitude', 'interest', 'teacherRemark'] as const;
    const teacherItems = remarks.filter(row => !row.locked && changed(row, teacherFields)).map(row => ({ learnerId: row.learnerId, conduct: value(row, 'conduct'), attitude: value(row, 'attitude'), interest: value(row, 'interest'), remark: value(row, 'teacherRemark') }));
    const headItems = head ? remarks.filter(row => !row.locked && changed(row, ['headRemark'])).map(row => ({ learnerId: row.learnerId, remark: value(row, 'headRemark') })) : [];
    if (!teacherItems.length && !headItems.length) throw new Error('Nothing has changed.');
    if (teacherItems.length) await send(`/assessment/classes/${classId}/remarks`, 'POST', { termId, author: 'class_teacher', items: teacherItems });
    if (headItems.length) await send(`/assessment/classes/${classId}/remarks`, 'POST', { termId, author: 'headteacher', items: headItems });
    // How the drafted remarks were used (kept as is or edited) is logged for the AI review; the remark text itself is not.
    if (remarkRun) { const kept = Object.entries(remarkRun.drafts).filter(([id]) => teacherItems.some(i => i.learnerId === id));
      if (kept.length) void request(`/schools/${schoolId}/ai/runs/${remarkRun.runId}/feedback`, { method: 'POST', headers, body: JSON.stringify({ outcome: kept.every(([id, text]) => teacherItems.find(i => i.learnerId === id)?.remark === text) ? 'accepted' : 'edited' }) }).catch(() => undefined);
      setRemarkRun(null); }
    await loadRemarks(); setMessage('Report card remarks saved.');
  });
  // Drafts the class teacher's remark for learners who have none yet, from the computed results; nothing is saved until the teacher saves.
  const suggestRemarks = () => void act(async () => {
    const r = await request<{ runId: string; source: string; note: string | null; items: { learnerId: string; remark: string }[] }>(`/schools/${schoolId}/ai/report-remarks-draft`, { method: 'POST', headers, body: JSON.stringify({ classId, termId }) });
    const empty = r.items.filter(i => !(remarkEdits[`${i.learnerId}:teacherRemark`] ?? '').trim());
    setRemarkEdits(prior => ({ ...prior, ...Object.fromEntries(empty.map(i => [`${i.learnerId}:teacherRemark`, i.remark])) }));
    setRemarkRun({ runId: r.runId, drafts: Object.fromEntries(empty.map(i => [i.learnerId, i.remark])) });
    setRemarkNote(`Drafted ${empty.length} remark(s) ${r.source === 'ai' ? 'with Claude' : 'from the results (AI drafting is off, so these are simple template remarks)'}. Read and edit each one, then save.${r.note?.startsWith('partial') ? ' Some use the simple template because the AI draft did not pass the checks.' : ''}`);
  });
  const openReportCards = () => void act(async () => {
    const r = await request<{ items: { id: string; snapshot: Snapshot }[] }>(`/schools/${schoolId}/assessment/classes/${classId}/reports?termId=${termId}`);
    if (!r.items.length) throw new Error('No terminal reports have been published for this class and term yet.');
    setPrinting(r.items);
  });
  // Every published report card in the term (or one level), one per printed page.
  const openSchoolReportCards = () => void act(async () => {
    const r = await request<{ items: { id: string; snapshot: Snapshot }[] }>(`/schools/${schoolId}/assessment/reports?termId=${termId}${printLevel ? `&level=${printLevel}` : ''}`);
    if (!r.items.length) throw new Error(`No terminal reports have been published for ${printLevel || 'any class'} this term yet.`);
    setPrinting(r.items);
  });
  const preview = () => void act(async () => { setResults((await request<{ items: Result[] }>(`/schools/${schoolId}/assessment/classes/${classId}/results?termId=${termId}`)).items); });
  const publish = () => { if (!window.confirm('Publish terminal reports for this class? Scores will be locked and guardians can see them.')) return;
    void act(async () => {
      const incomplete = results.filter(r => !r.complete).length;
      if (incomplete && !window.confirm(`${incomplete} learner(s) have missing scores. Publish their incomplete reports anyway?`)) return;
      const r = await send<{ published: number }>(`/assessment/classes/${classId}/publish`, 'POST', { termId, acknowledgeIncomplete: incomplete > 0 });
      await loadGrid(); setMessage(`Published ${r.published} report(s).`);
    }); };

  const resultsTable = results.length > 0 && <>
    <div className="table-wrap"><table><thead><tr><th>Learner</th><th className="num">Position</th><th className="num">Average</th><th>Subjects</th></tr></thead><tbody>{results.map(r => <tr key={r.learnerId}><td>{r.fullName}{!r.complete && <> <Pill tone="caution">Missing scores</Pill></>}</td><td className="num">{r.position ?? '–'}</td><td className="num">{r.complete ? r.average : '–'}</td><td>{r.subjects.map(s => `${s.name}: ${s.total ?? '–'}${s.grade ? ` (${s.grade})` : ''}`).join(' · ')}</td></tr>)}</tbody></table></div>
    <div className="actions card-actions"><button disabled={busy} onClick={publish}>Publish terminal reports</button></div></>;
  // Mock exams are a JHS matter (BECE preparation).
  const isJhs = (classes.find(c => c.id === classId)?.level ?? 'JHS') === 'JHS';
  useEffect(() => { if (!isJhs && tab === 'mocks') setTab('work'); }, [isJhs, tab]);
  const picks = <>
    <label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
    <label>Term<select value={termId} onChange={e => setTermId(e.target.value)}><option value="">Choose a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>
    <Tabs label="Assessment view" value={tab} onChange={setTab} options={[{ id: 'work', label: 'Class work' }, { id: 'ca', label: 'CA sheet' }, { id: 'scores', label: 'Exam scores' }, ...(isJhs ? [{ id: 'mocks' as const, label: 'Mocks' }] : []), { id: 'remarks', label: 'Remarks' }, { id: 'reports', label: 'Report cards' }]}/></>;
  return <section aria-label="Assessment and terminal reports" className="page">
    <h2 className="sr-only">{view === 'setup' ? 'Subjects, terms and grading' : 'Assessment and terminal reports'}</h2>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {head && view !== 'work' && <SetupWrap open={view === 'setup'}>
      <Card title="Subjects" hint="The subjects your school records scores for.">
        {subjects.length ? <div className="pill-row">{subjects.map(s => <Pill key={s.id}>{s.name}</Pill>)}</div> : <p className="muted">No subjects yet.</p>}
        <form onSubmit={addSubject} className="inline-form"><label>New subject<input value={newSubject} onChange={e => setNewSubject(e.target.value)} required minLength={2} maxLength={80} placeholder="Mathematics"/></label><button disabled={busy}>Add subject</button></form>
      </Card>
      <Card title="Terms" hint="Each term belongs to an academic year. Scores, reports and fees are recorded per term." flush>
        {terms.length ? <div className="table-wrap"><table><thead><tr><th>Term</th><th>Year</th><th>Starts</th><th>Ends</th></tr></thead><tbody>{terms.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.year_name}</td><td>{dayLabel(t.start_date)}</td><td>{dayLabel(t.end_date)}</td></tr>)}</tbody></table></div> : <Empty title="No terms yet" hint="Add the first term below."/>}
        <form onSubmit={addTerm} className="card-body"><h4>Add a term</h4><div className="grid"><label>Year for this term<select value={newTerm.academicYearId} onChange={e => setNewTerm({ ...newTerm, academicYearId: e.target.value })} required><option value="">Choose a year</option>{years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
          <label>Term name<input value={newTerm.name} onChange={e => setNewTerm({ ...newTerm, name: e.target.value })} required placeholder="Term 1"/></label>
          <label>Term start date<input type="date" value={newTerm.startDate} onChange={e => setNewTerm({ ...newTerm, startDate: e.target.value })} required/></label>
          <label>Term end date<input type="date" value={newTerm.endDate} onChange={e => setNewTerm({ ...newTerm, endDate: e.target.value })} required/></label></div><button disabled={busy}>Add term</button></form>
      </Card>
      <Card title="Grading policy" hint="Set from your school's own policy: how class work and exams count, and where each grade begins.">
        <form onSubmit={savePolicy}>
          <div className="grid"><label>Continuous assessment (CA) counts for (% of the final score)<input type="number" min={0} max={100} value={policyForm.caWeight} onChange={e => changeCaWeight(e.target.value)} required/></label>
          <label>Exam counts for (% of the final score)<input type="number" value={policyForm.examWeight} readOnly/></label></div>
          <p className="muted">Every mark is recorded out of 100, for the CA and for the exam. Each is then scaled to its share: with CA {caWeightNow}% and exam {examWeightNow}%, a CA of 80 and an exam of 70 give {Math.round((80 * caWeightNow + 70 * examWeightNow) / 10) / 10} out of 100.</p>
          {caWeightNow > 0 && <fieldset className="ca-parts"><legend>What the CA is made of (% of the final score)</legend>
            {caPartLabels.map(([key, , long]) => <label key={key}>{long}<input type="number" min={0} max={caWeightNow} step={0.5} value={policyForm.parts[key]} onChange={e => setPolicyForm({ ...policyForm, parts: { ...policyForm.parts, [key]: e.target.value } })} required/>
              {key === 'tests' && partPoints.tests > 0 && <span className="sub">Two tests count {Math.round(partPoints.tests * 5) / 10} each</span>}</label>)}
            <p className={partsTotal === caWeightNow ? 'muted' : 'field-error'}>Total {partsTotal} of {caWeightNow}. For example, with the CA at 50%: class exercises 15, homework 15 and class tests 20 (two tests at 10 each). Put 0 for a part your school does not count. If a learner has no marks in a part, that part is skipped for them and the other parts count for more.</p></fieldset>}
          <label>Grade bands (one per line: minimum score, grade, remark)<textarea rows={6} value={policyForm.bands} onChange={e => setPolicyForm({ ...policyForm, bands: e.target.value })} required/></label>
          <label>Where this policy comes from<input value={policyForm.sourceNote} onChange={e => setPolicyForm({ ...policyForm, sourceNote: e.target.value })} required minLength={3} placeholder="e.g. School policy memo, September 2026"/></label><button disabled={busy}>Save policy</button></form>
      </Card></SetupWrap>}
    {view !== 'setup' && <>{!policy && <p className="muted">{head ? 'Set the grading policy in Settings before scores can be recorded.' : 'The headteacher has not set the grading policy yet.'}</p>}
    <Card flush>
      <div className="toolbar">{picks}</div>
      {!classId || !termId ? <Empty title={classes.length ? 'Choose a class and term' : 'No classes yet'} hint={classes.length ? undefined : head ? 'Add classes in Settings first.' : 'You have no class assigned today.'}/>
      : tab === 'work' ? <ClassWork schoolId={schoolId} csrfToken={csrfToken} classId={classId} className={classes.find(c => c.id === classId)?.name ?? ''} termId={termId} subjects={subjects} subjectId={workSubject} onSubject={setWorkSubject} onChanged={() => void loadGrid()}/>
      : tab === 'mocks' && isJhs ? <Mocks key={classId} schoolId={schoolId} csrfToken={csrfToken} classId={classId} termId={termId} subjects={subjects} mode="record"/>
      : tab === 'ca' ? <CaSheet schoolId={schoolId} classId={classId} termId={termId} subjects={subjects} subjectId={workSubject} onSubject={setWorkSubject}/>
      : tab === 'scores' ? <>
        <div className="toolbar"><label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">Choose a subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><span className="count">{grid.length} learner{grid.length === 1 ? '' : 's'}</span></div>
        {grid.length > 0 && subjectId ? <><p className="muted card-body">Enter each learner's exam mark out of 100. The continuous assessment comes from the class work recorded on the Class work tab{policy ? ` (CA ${policy.ca_weight}%, exam ${policy.exam_weight}%)` : ''}, so it cannot be typed here; it is saved with the exam marks.</p>
          <div className="table-wrap"><table><thead><tr><th>Learner</th><th className="num">CA from class work<span className="sub">out of 100</span></th><th>Exam (0–100)</th><th className="num hide-sm">Total</th>{head && <th>Published report</th>}</tr></thead><tbody>
          {grid.map(row => { const ca = caFor(row), fromWork = classCa?.[row.learnerId], examText = edits[`${row.learnerId}:exam`] ?? (row.exam ?? ''), exam = examText === '' ? null : Number(examText);
            const caNote = row.locked ? 'report published' : !fromWork?.ca && fromWork?.ca !== 0 ? (row.ca === null ? 'no class work marked yet' : 'entered earlier · no class work marked') : `${fromWork.assessments} mark${fromWork.assessments === 1 ? '' : 's'}${row.ca === fromWork.ca ? ' · saved' : row.ca === null ? ' · saved with exam' : ` · was ${row.ca}, saved with exam`}`;
            return <tr key={row.learnerId}><td>{row.fullName}</td>
              <td className="num">{ca === null ? <span className="muted">–</span> : <strong>{ca}</strong>}<span className="sub">{caNote}</span></td>
              <td><input type="number" min={0} max={100} step="0.01" aria-label={`${row.fullName} exam`} disabled={row.locked} value={examText} onChange={e => setEdits({ ...edits, [`${row.learnerId}:exam`]: e.target.value })}/></td>
              <td className="num hide-sm">{policy && ca !== null && exam !== null && !Number.isNaN(exam) ? Math.round((ca * policy.ca_weight + exam * policy.exam_weight) / 10) / 10 : <span className="muted">–</span>}</td>
              {head && <td>{row.locked ? <button type="button" className="secondary" disabled={busy} onClick={() => reopen(row)}>Correct this report</button> : row.published ? <button type="button" disabled={busy} onClick={() => reissue(row)}>Publish corrected report</button> : '–'}</td>}</tr>; })}</tbody></table></div>
          {grid.some(row => !row.locked) ? <div className="actions card-actions"><button disabled={busy || !policy} onClick={saveScores}>Save exam scores</button></div>
            : <p className="muted card-body">Every report in this class is published, so these marks are locked.{head ? ' Use "Correct this report" to change one.' : ''}</p>}</>
          : <Empty title={subjectId ? 'No learners in this class' : 'Choose a subject'} hint={subjectId ? undefined : 'Pick the subject whose exam marks you are entering.'}/>}
      </> : tab === 'remarks' ? (remarks.length > 0 ? <>
        <p className="muted">{head ? 'Class teachers fill conduct, attitude, interest and their remark; you add the headteacher\'s remark. Locked once the report is published.' : 'Conduct, attitude, interest and your remark for each learner. Locked once the report is published.'}</p>
        {remarkNote && <p role="status">{remarkNote}</p>}
        <div className="table-wrap"><table className="remarks-table"><thead><tr><th>Learner</th>{remarkFields.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {remarks.map(row => <tr key={row.learnerId}><td>{row.fullName}{row.locked && <> <Pill>published</Pill></>}{remarkRun?.drafts[row.learnerId] !== undefined && <> <Pill tone="info">draft, not saved</Pill></>}</td>{remarkFields.map(([field, label]) => {
            const key = `${row.learnerId}:${field}`, readOnly = row.locked || (field === 'headRemark' && !head);
            const long = field.endsWith('emark'), props = { 'aria-label': `${row.fullName} ${label}`, maxLength: long ? 300 : 120, value: remarkEdits[key] ?? row[field] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setRemarkEdits({ ...remarkEdits, [key]: e.target.value }) };
            return <td key={field} className={long ? 'remark-cell' : undefined}>{readOnly ? (row[field] ?? '–') : long ? <textarea rows={2} {...props}/> : <input {...props}/>}</td>;
          })}</tr>)}</tbody></table></div>
        <div className="actions card-actions"><button disabled={busy} onClick={saveRemarks}>Save remarks</button>{remarks.some(r => !r.locked && !r.teacherRemark) && <button className="secondary" disabled={busy} onClick={suggestRemarks}><Icon name="auto_awesome"/>Suggest remarks</button>}</div></>
        : <Empty title="No learners in this class" hint="Remarks appear once learners are enrolled."/>)
      : <div className="card-body">
        <h4>This class</h4>
        <p className="muted">{head ? 'Look at the results, then publish the terminal reports. Publishing locks the scores and shows the reports to guardians.' : 'Reports the headteacher has published for this class and term.'}</p>
        <div className="actions">{head && <button className="secondary" disabled={busy} onClick={preview}>Preview results</button>}<button className="secondary" disabled={busy} onClick={openReportCards}><Icon name="description"/>Report cards</button></div>
        {resultsTable}
        {head && <><h4>Whole school or one level</h4><p className="muted">Print every published report card for the term, one per page.</p>
          <div className="actions"><label>Report cards for<select value={printLevel} onChange={e => setPrintLevel(e.target.value)}><option value="">The whole school</option>{['Nursery', 'KG', 'Primary', 'JHS'].map(l => <option key={l} value={l}>{l}</option>)}</select></label>
            <button type="button" className="secondary" disabled={busy || !termId} onClick={openSchoolReportCards}><Icon name="print"/>Print report cards</button></div></>}
      </div>}
    </Card>
    {tab === 'ca' && classId && termId && <WorkSet schoolId={schoolId} classId={classId} termId={termId} subjectId={workSubject}/>}
    {printing && <Dialog title="Report cards" wide onClose={() => setPrinting(null)}>
      <div className="actions"><button type="button" onClick={() => window.print()}>Print all ({printing.length})</button></div>
      <div className="report-sheet">{printing.map(r => <ReportCard key={r.id} snapshot={r.snapshot}/>)}</div>
    </Dialog>}
    </>}
  </section>;
}

const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
// The Ghanaian terminal report as printed for families: school header, scores, position, attendance, conduct and remarks.
// Reports published before these details existed show what they hold.
export function ReportCard({ snapshot: r }: { snapshot: Snapshot }) {
  return <article className="report-card">
    <header className="report-card-head"><h3>{r.school?.name ?? 'Terminal report'}</h3>{r.school?.motto && <p className="report-motto">{r.school.motto}</p>}{(r.school?.address || r.school?.phone) && <p>{[r.school.address, r.school.phone].filter(Boolean).join(' · ')}</p>}<p className="report-title">Terminal report · {r.term.name}{r.yearName ? `, ${r.yearName}` : ''}</p></header>
    <dl className="report-facts">
      <div><dt>Name</dt><dd>{r.learner?.fullName}</dd></div><div><dt>Admission no.</dt><dd>{r.learner?.admissionNumber}</dd></div><div><dt>Class</dt><dd>{r.class.name}</dd></div>
      <div><dt>Position</dt><dd>{r.position ? `${ordinal(r.position)} of ${r.classSize}` : '–'}</dd></div><div><dt>Average</dt><dd>{r.average ?? '–'}</dd></div>
      {r.attendance && <div><dt>Attendance</dt><dd>{r.attendance.present} out of {r.attendance.possible}</dd></div>}
    </dl>
    <div className="table-wrap"><table><thead><tr><th>Subject</th><th className="num">Class score ({r.policy.caWeight}%)</th><th className="num">Exam ({r.policy.examWeight}%)</th><th className="num">Total</th><th>Grade</th><th>Remark</th></tr></thead>
      <tbody>{r.subjects.map(s => <tr key={s.name}><td>{s.name}</td><td className="num">{s.ca ?? '–'}</td><td className="num">{s.exam ?? '–'}</td><td className="num">{s.total ?? '–'}</td><td>{s.grade ?? '–'}</td><td>{s.remark ?? ''}</td></tr>)}</tbody></table></div>
    {!r.complete && <p>Some scores were not available when this report was published.</p>}
    <dl className="report-remarks">
      {r.conduct && <div><dt>Conduct</dt><dd>{r.conduct}</dd></div>}{r.attitude && <div><dt>Attitude</dt><dd>{r.attitude}</dd></div>}{r.interest && <div><dt>Interest</dt><dd>{r.interest}</dd></div>}
      {r.teacherRemark && <div><dt>Class teacher's remark</dt><dd>{r.teacherRemark}</dd></div>}{r.headRemark && <div><dt>Headteacher's remark</dt><dd>{r.headRemark}</dd></div>}
      {r.nextTermBegins && <div><dt>Next term begins</dt><dd>{longDate(r.nextTermBegins)}</dd></div>}
    </dl>
    <p className="muted">Grading: {r.policy.sourceNote}</p>
  </article>;
}

type Snapshot = { term: { name: string }; class: { name: string }; classSize: number; average: number | null; position: number | null; complete: boolean; policy: { caWeight: number; examWeight: number; sourceNote: string };
  subjects: { name: string; ca: number | null; exam: number | null; total: number | null; grade: string | null; remark: string | null }[];
  learner?: { fullName: string; admissionNumber: string }; yearName?: string | null; school?: { name: string; address: string | null; phone: string | null; motto: string | null }; nextTermBegins?: string | null;
  attendance?: { present: number; possible: number }; conduct?: string | null; attitude?: string | null; interest?: string | null; teacherRemark?: string | null; headRemark?: string | null };
export function GuardianTerminalReports({ schoolId, childId: chosenChild }: { schoolId: string; childId?: string }) {
  const [children, setChildren] = useState<{ id: string; full_name: string; academic: boolean }[]>([]);
  const [childId, setChildId] = useState('');
  const [reports, setReports] = useState<{ id: string; snapshot: Snapshot; published_at: string }[]>([]);
  const [error, setError] = useState('');
  const [which, setWhich] = useState('');
  useEffect(() => { request<{ id: string; full_name: string; academic: boolean }[]>(`/schools/${schoolId}/guardian/children`).then(rows => { const academic = rows.filter(r => r.academic); setChildren(academic); setChildId(prior => prior || academic[0]?.id || ''); }).catch(e => setError((e as Error).message)); }, [schoolId, chosenChild]);
  // In the guardian portal the page's child picker chooses the child; only children with academic access have reports.
  const reportChild = chosenChild === undefined ? childId : children.some(c => c.id === chosenChild) ? chosenChild : '';
  useEffect(() => { setReports([]); setWhich(''); if (!reportChild) return; request<{ items: typeof reports }>(`/schools/${schoolId}/guardian/children/${reportChild}/terminal-reports`).then(r => setReports([...r.items].sort((a, b) => b.published_at.localeCompare(a.published_at)))).catch(e => setError((e as Error).message)); }, [schoolId, reportChild]);
  if (chosenChild !== undefined && !reportChild && !error) return null;
  // With several terms published, a parent reads one report at a time (the newest first) instead of scrolling past them all.
  const termLabel = (r: { snapshot: Snapshot }) => `${r.snapshot.term.name}${r.snapshot.yearName ? ` · ${r.snapshot.yearName}` : ''}`;
  const shown = reports.find(r => r.id === which) ?? reports[0];
  return <section aria-label="Terminal reports" className="page">
    <Card title="Terminal reports" hint="Published at the end of each term." action={chosenChild === undefined ? <label className="inline-field">Child<select value={childId} onChange={e => setChildId(e.target.value)}><option value="">Choose a child</option>{children.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label> : undefined} flush>
      {error && <p role="alert">{error}</p>}
      {reportChild && !reports.length && <Empty title="No terminal reports yet" hint="They appear here once the school publishes them."/>}
      {reports.length > 1 && <div className="card-body"><Tabs label="Term" value={shown!.id} onChange={setWhich} options={reports.map(r => ({ id: r.id, label: termLabel(r) }))}/></div>}
      {shown && <ReportCard key={shown.id} snapshot={shown.snapshot}/>}
    </Card>
  </section>;
}
