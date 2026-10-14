import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Stat, Tabs, currentTerm, todayInAccra } from '../lib/ui';

type Page<T> = { items: T[] };
type Subject = { id: string; name: string };
type Term = { id: string; name: string; year_name: string; start_date: string; end_date: string };
type ClassOption = { id: string; name: string; year_name: string };
type Assessment = { id: string; subject_id: string; subject_name: string; kind: string; title: string; held_on: string; max_mark: number; marked: number; average: number | null; indicators?: { id: string; code: string | null; description: string }[] };
type Indicator = { id: string; code: string | null; strand: string | null; sub_strand: string | null; description: string; retired_at: string | null };
type Gap = { indicatorId: string; subject: string; code: string | null; strand: string | null; subStrand: string | null; description: string; assessments: number; learners: number; average: number | null; belowPass: number; belowShare: number | null; below: { learnerId: string; fullName: string; average: number }[] };
type RosterRow = { learnerId: string; fullName: string; left: boolean; mark: number | null };
type ClassProgress = { buckets: string[]; overall: { start: string; average: number | null }[]; subjects: { subjectId: string; name: string; points: { start: string; average: number | null; marks: number }[] }[];
  attention: { learnerId: string; fullName: string; subject: string; reason: 'dropping' | 'below_pass'; recent: number; earlier: number | null }[] };
type LearnerProgress = { learner: { fullName: string; admissionNumber: string }; buckets: { key: string; label: string }[]; overall: { key: string; assessmentAverage: number | null }[];
  subjects: { subjectId: string; name: string; points: { key: string; assessmentAverage: number | null; marks: number; termResult: number | null }[] }[] };

const kinds = [['classwork', 'Class exercise'], ['homework', 'Homework'], ['quiz', 'Quiz'], ['class_test', 'Class test'], ['project', 'Project']] as const;
const kindLabel = (kind: string) => kinds.find(([id]) => id === kind)?.[1] ?? kind;
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const bucketLabel = (start: string, period: string) => period === 'month' ? monthName(start) : `Week of ${shortDate(start)}`;
const tone = (n: number | null) => n === null ? 'neutral' : n >= 70 ? 'positive' : n >= 50 ? 'caution' : 'critical';
// A percentage with a small bar, so a row of weeks reads as a trend at a glance.
const Score = ({ value, sub }: { value: number | null; sub?: string }) => value === null ? <span className="muted">–</span>
  : <span className="trend-cell"><span className={`trend-value tone-${tone(value)}`}>{value}%</span><span className="trend-bar"><span className={`trend-fill fill-${tone(value)}`} style={{ width: `${Math.min(100, value)}%` }}/></span>{sub && <span className="sub">{sub}</span>}</span>;

export function Progress({ schoolId, csrfToken, role }: { schoolId: string; csrfToken: string; role: string }) {
  const head = role === 'headteacher';
  const [subjects, setSubjects] = useState<Subject[]>([]); const [terms, setTerms] = useState<Term[]>([]); const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState(''); const [termId, setTermId] = useState(''); const [subjectId, setSubjectId] = useState('');
  const [tab, setTab] = useState<'assessments' | 'trends' | 'gaps'>('trends');
  const [gaps, setGaps] = useState<{ items: Gap[]; untaggedAssessments: number } | null>(null);
  const [indicators, setIndicators] = useState<Indicator[]>([]); const [chosen, setChosen] = useState<string[]>([]); const [indicatorSearch, setIndicatorSearch] = useState('');
  const [assessments, setAssessments] = useState<Assessment[]>([]); const [progress, setProgress] = useState<ClassProgress | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [creating, setCreating] = useState(false); const [form, setForm] = useState({ subjectId: '', kind: 'classwork', title: '', heldOn: todayInAccra(), maxMark: '20' });
  const [marking, setMarking] = useState<{ assessment: Assessment; items: RosterRow[] } | null>(null); const [marks, setMarks] = useState<Record<string, string>>({});
  const [learnerId, setLearnerId] = useState(''); const [roster, setRoster] = useState<{ learnerId: string; fullName: string }[]>([]);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const headers = { 'x-csrf-token': csrfToken };
  const send = <T,>(path: string, body: object) => request<T>(`/schools/${schoolId}${path}`, { method: 'POST', headers, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });

  useEffect(() => { void (async () => {
    try {
      const [s, t, c] = await Promise.all([request<Page<Subject>>(`/schools/${schoolId}/assessment/subjects`), request<Page<Term>>(`/schools/${schoolId}/assessment/terms`),
        request<Page<ClassOption>>(head ? `/schools/${schoolId}/teaching/class-options?limit=100` : `/schools/${schoolId}/teaching/classes?date=${todayInAccra()}&limit=100`)]);
      setSubjects(s.items); setTerms(t.items); setClasses(c.items);
      setClassId(c.items[0]?.id ?? ''); setTermId(currentTerm(t.items)?.id ?? '');
    } catch (e) { setError((e as Error).message); } finally { setLoaded(true); }
  })(); }, [schoolId, head]);

  // Only the latest request may fill the page, so a quick change of class never shows another class's data.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const current = ++latest.current;
    setAssessments([]); setProgress(null); setRoster([]); setGaps(null);
    if (!classId || !termId) return;
    try {
      const [a, p, g, gp] = await Promise.all([
        request<Page<Assessment>>(`/schools/${schoolId}/assessment/classes/${classId}/assessments?termId=${termId}${subjectId ? `&subjectId=${subjectId}` : ''}`),
        request<ClassProgress>(`/schools/${schoolId}/assessment/classes/${classId}/progress?termId=${termId}&period=${period}`),
        request<Page<{ learnerId: string; fullName: string }>>(`/schools/${schoolId}/assessment/classes/${classId}/grid?termId=${termId}`),
        request<{ items: Gap[]; untaggedAssessments: number }>(`/schools/${schoolId}/assessment/classes/${classId}/gaps?termId=${termId}${subjectId ? `&subjectId=${subjectId}` : ''}`)]);
      if (current !== latest.current) return;
      setAssessments(a.items); setProgress(p); setRoster(g.items); setGaps(gp);
    } catch (e) { if (current === latest.current) setError((e as Error).message); }
  }, [schoolId, classId, termId, subjectId, period]);
  useEffect(() => { void load(); }, [load]);

  // Current indicators of the subject chosen in the new-assessment dialog.
  useEffect(() => { setIndicators([]); setChosen([]); setIndicatorSearch('');
    if (!creating || !form.subjectId) return;
    let live = true;
    request<Page<Indicator>>(`/schools/${schoolId}/assessment/indicators?subjectId=${form.subjectId}`).then(r => { if (live) setIndicators(r.items.filter(i => !i.retired_at)); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; }; }, [schoolId, creating, form.subjectId]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const create = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    const a = await send<Assessment>(`/assessment/classes/${classId}/assessments`, { termId, subjectId: form.subjectId, kind: form.kind, title: form.title, heldOn: form.heldOn, maxMark: Number(form.maxMark), ...(chosen.length ? { indicatorIds: chosen } : {}) });
    setCreating(false); setForm({ ...form, title: '' }); await load();
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
    setMarking(null); await load(); setMessage(`Saved ${r.written} mark(s) for ${marking.assessment.title}.`);
  });

  const attentionCount = progress?.attention.length ?? 0;
  const lastOverall = progress?.overall.filter(o => o.average !== null).slice(-2) ?? [];
  const change = lastOverall.length === 2 ? Math.round((lastOverall[1]!.average! - lastOverall[0]!.average!) * 10) / 10 : null;
  return <section aria-label="Learner progress" className="page">
    <PageHeader eyebrow="Teaching" title="Progress" blurb="Record class exercises, homework and tests as they happen, and follow each class and learner week by week."
      actions={<button disabled={!classId || !termId || !subjects.length} onClick={() => { setForm(f => ({ ...f, subjectId: f.subjectId || subjectId || subjects[0]?.id || '' })); setCreating(true); }}><Icon name="add"/>New assessment</button>}/>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <Card flush>
      <div className="toolbar">
        <label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
        <label>Term<select value={termId} onChange={e => setTermId(e.target.value)}><option value="">Choose a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>
        <Tabs label="Progress view" value={tab} onChange={setTab} options={[{ id: 'trends', label: 'Trends' }, { id: 'gaps', label: 'Gaps' }, { id: 'assessments', label: 'Assessments' }]}/>
      </div>
      {!classId || !termId ? (loaded && <Empty title={classes.length ? 'Choose a class and term' : 'No classes yet'} hint={classes.length ? undefined : head ? 'Add classes in Settings first.' : 'You have no class assigned today.'}/>)
        : tab === 'assessments' ? <>
          <div className="toolbar"><label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">All subjects</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><span className="count">{assessments.length} this term</span></div>
          {!assessments.length ? <Empty title="No assessments recorded yet" hint="Add each class exercise, homework or test with its date and marks to see progress week by week."/>
            : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Assessment</th><th>Subject</th><th className="num">Marked</th><th>Class average</th><th/></tr></thead><tbody>
              {assessments.map(a => <tr key={a.id}><td>{shortDate(a.held_on)}</td><td>{a.title}<span className="sub">{kindLabel(a.kind)} · out of {a.max_mark}{a.indicators?.length ? ` · ${a.indicators.map(i => i.code ?? i.description).join(', ')}` : ''}</span></td><td>{a.subject_name}</td><td className="num">{a.marked}</td><td><Score value={a.average}/></td>
                <td><button type="button" className="secondary" disabled={busy} onClick={() => void act(() => openMarks(a))}>Enter marks</button></td></tr>)}</tbody></table></div>}
        </> : tab === 'gaps' ? <>
          <div className="toolbar"><label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">All subjects</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><span className="count">Weakest first</span></div>
          {!gaps ? <p className="muted card-body" role="status">Loading…</p> : !gaps.items.length ? <Empty title="No indicators tested yet this term" hint={head ? 'Add your curriculum indicators in Settings, then tag them when creating assessments.' : 'Tag curriculum indicators when you create an assessment to see which ones the class has not mastered.'}/>
            : <div className="table-wrap"><table><thead><tr><th>Indicator</th><th>Class average</th><th>Below 50%</th><th>Learners below 50%</th></tr></thead><tbody>
              {gaps.items.map(g => <tr key={g.indicatorId}><td>{g.code && <strong>{g.code} </strong>}{g.description}<span className="sub">{[g.subject, g.strand, g.subStrand].filter(Boolean).join(' · ')} · {g.assessments} assessment{g.assessments === 1 ? '' : 's'}</span></td>
                <td><Score value={g.average}/></td><td className="num">{g.belowPass} of {g.learners}{g.belowShare !== null && <span className="sub">{g.belowShare}%</span>}</td>
                <td>{g.below.length ? <span className="chip-list">{g.below.map(b => <button key={b.learnerId} type="button" className="link-button" onClick={() => setLearnerId(b.learnerId)}>{b.fullName} ({b.average}%)</button>)}</span> : <span className="muted">None</span>}</td></tr>)}</tbody></table></div>}
          {gaps && gaps.untaggedAssessments > 0 && <p className="muted card-body">{gaps.untaggedAssessments} assessment(s) this term have no indicators tagged, so they are not counted here.</p>}
        </> : <>
          <div className="toolbar"><Tabs label="Group by" value={period} onChange={setPeriod} options={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]}/>
            <label>Learner<select value={learnerId} onChange={e => setLearnerId(e.target.value)}><option value="">View one learner…</option>{roster.map(l => <option key={l.learnerId} value={l.learnerId}>{l.fullName}</option>)}</select></label></div>
          {!progress ? <p className="muted card-body" role="status">Loading…</p> : !progress.buckets.length ? <Empty title="No marks recorded yet this term" hint="Trends appear once assessments have marks."/>
            : <div className="table-wrap"><table className="trend-table"><thead><tr><th>Subject</th>{progress.buckets.map(b => <th key={b}>{bucketLabel(b, period)}</th>)}</tr></thead><tbody>
              {progress.subjects.map(s => <tr key={s.subjectId}><td>{s.name}</td>{s.points.map(p => <td key={p.start}><Score value={p.average} sub={p.marks ? `${p.marks} mark${p.marks === 1 ? '' : 's'}` : undefined}/></td>)}</tr>)}
              <tr className="trend-total"><td>All subjects</td>{progress.overall.map(o => <td key={o.start}><Score value={o.average}/></td>)}</tr></tbody></table></div>}
        </>}
    </Card>
    {tab === 'trends' && progress && progress.buckets.length > 0 && <>
      <div className="stats">
        <Stat label="Class average" value={lastOverall.length ? `${lastOverall[lastOverall.length - 1]!.average}%` : '–'} caption={`Latest ${period}`} icon="insights" tone={tone(lastOverall[lastOverall.length - 1]?.average ?? null)}/>
        <Stat label={`Change on last ${period}`} value={change === null ? '–' : `${change > 0 ? '+' : ''}${change}`} caption="Percentage points" icon={change !== null && change < 0 ? 'trending_down' : 'trending_up'} tone={change === null ? 'neutral' : change < 0 ? 'critical' : 'positive'}/>
        <Stat label="Need attention" value={attentionCount} caption="Learner and subject pairs" icon="flag" tone={attentionCount ? 'caution' : 'neutral'}/>
      </div>
      <Card title="Needs attention" hint={`Last 3 marks in a subject average below 50%, or are 10 or more points below the learner's earlier marks this term.`} flush>
        {!attentionCount ? <Empty title="Nobody flagged" hint="Every learner with three or more marks is holding steady."/>
          : <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Subject</th><th>Why</th><th>Recent</th><th>Earlier</th></tr></thead><tbody>
            {progress.attention.map(a => <tr key={`${a.learnerId}:${a.subject}`}><td><button type="button" className="link-button" onClick={() => setLearnerId(a.learnerId)}>{a.fullName}</button></td><td>{a.subject}</td>
              <td><Pill tone={a.reason === 'dropping' ? 'critical' : 'caution'}>{a.reason === 'dropping' ? 'Dropping' : 'Below 50%'}</Pill></td><td><Score value={a.recent}/></td><td><Score value={a.earlier}/></td></tr>)}</tbody></table></div>}
      </Card>
    </>}
    {creating && <Dialog title="New assessment" onClose={() => setCreating(false)}>
      <form onSubmit={create}>
        <label>Subject<select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })} required><option value="">Choose a subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Type<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={2} maxLength={120} placeholder="e.g. Fractions exercise 3"/></label>
        <label>Date<input type="date" value={form.heldOn} onChange={e => setForm({ ...form, heldOn: e.target.value })} required/></label>
        <label>Marked out of<input type="number" min={1} max={1000} step="0.5" value={form.maxMark} onChange={e => setForm({ ...form, maxMark: e.target.value })} required/></label>
        {indicators.length > 0 && <fieldset className="indicator-picker"><legend>Curriculum indicators tested (optional)</legend>
          {indicators.length > 8 && <input type="search" aria-label="Search indicators" placeholder="Search by code or words" value={indicatorSearch} onChange={e => setIndicatorSearch(e.target.value)}/>}
          <div className="indicator-options">{indicators.filter(i => !indicatorSearch || `${i.code ?? ''} ${i.description} ${i.strand ?? ''} ${i.sub_strand ?? ''}`.toLowerCase().includes(indicatorSearch.toLowerCase())).slice(0, 40).map(i =>
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
    {learnerId && <LearnerProgressDrawer schoolId={schoolId} learnerId={learnerId} onClose={() => setLearnerId('')}/>}
  </section>;
}

// One learner over time: weeks and months from dated assessments; terms and years also show the term result.
function LearnerProgressDrawer({ schoolId, learnerId, onClose }: { schoolId: string; learnerId: string; onClose: () => void }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'term' | 'year'>('month');
  const [data, setData] = useState<LearnerProgress | null>(null); const [error, setError] = useState('');
  useEffect(() => { let live = true; setData(null); setError('');
    request<LearnerProgress>(`/schools/${schoolId}/assessment/learners/${learnerId}/progress?period=${period}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; }; }, [schoolId, learnerId, period]);
  const label = (b: { key: string; label: string }) => period === 'week' ? `Week of ${shortDate(b.label)}` : period === 'month' ? monthName(b.label) : b.label;
  const withResults = period === 'term' || period === 'year';
  return <Dialog title={data ? data.learner.fullName : 'Learner progress'} drawer onClose={onClose}>
    {data && <p className="muted">{data.learner.admissionNumber}</p>}
    <Tabs label="Group by" value={period} onChange={setPeriod} options={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }, { id: 'term', label: 'Termly' }, { id: 'year', label: 'Yearly' }]}/>
    {error && <p role="alert">{error}</p>}
    {data && (!data.buckets.length ? <Empty title="Nothing recorded yet" hint="Marks and term results appear here as they are entered."/>
      : <div className="table-wrap"><table className="trend-table"><thead><tr><th>Subject</th>{data.buckets.map(b => <th key={b.key}>{label(b)}</th>)}</tr></thead><tbody>
        {data.subjects.map(s => <tr key={s.subjectId}><td>{s.name}</td>{s.points.map(p => <td key={p.key}>{withResults && p.termResult !== null ? <Score value={p.termResult} sub={p.assessmentAverage !== null ? `Assessments ${p.assessmentAverage}%` : 'Term result'}/> : <Score value={p.assessmentAverage} sub={p.marks ? `${p.marks} mark${p.marks === 1 ? '' : 's'}` : undefined}/>}</td>)}</tr>)}
        <tr className="trend-total"><td>All assessments</td>{data.overall.map(o => <td key={o.key}><Score value={o.assessmentAverage}/></td>)}</tr></tbody></table></div>)}
    {withResults && <p className="muted">Termly and yearly cells show the term result (class score and exam, weighted by the school's policy) where it has been recorded, with the average of that term's assessments beneath.</p>}
  </Dialog>;
}
