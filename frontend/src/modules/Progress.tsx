import React, { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Stat, Tabs, currentTerm, todayInAccra } from '../lib/ui';
import { Plan, PlanDraft, SupportList, SupportPlanDialog, SupportPlanDrawer } from './Support';
import { PracticeDialog } from './Practice';
import { Mocks } from './Mocks';
import { ClassHomePractice } from './HomePracticeStaff';

type Page<T> = { items: T[] };
type Subject = { id: string; name: string };
type Term = { id: string; name: string; year_name: string; start_date: string; end_date: string };
type ClassOption = { id: string; name: string; level?: string; year_name: string };
type Gap = { resources: number; indicatorId: string; subjectId: string; subject: string; code: string | null; strand: string | null; subStrand: string | null; description: string; assessments: number; learners: number; average: number | null; belowPass: number; belowShare: number | null; below: { learnerId: string; fullName: string; average: number }[] };
type Results = { policy: { caWeight: number; examWeight: number }; classSize: number; items: { learnerId: string; fullName: string; left: boolean; complete: boolean; average: number | null; position: number | null;
  subjects: { subjectId: string; name: string; ca: number | null; exam: number | null; total: number | null; grade: string | null }[] }[] };
type ClassProgress = { classSize: number; buckets: string[]; overall: { start: string; average: number | null; learners: number }[]; subjects: { subjectId: string; name: string; points: { start: string; average: number | null; marks: number }[] }[];
  attention: { learnerId: string; fullName: string; subjectId: string; subject: string; reason: 'dropping' | 'below_pass'; recent: number; earlier: number | null }[] };
type LearnerProgress = { learner: { fullName: string; admissionNumber: string }; buckets: { key: string; label: string }[]; overall: { key: string; assessmentAverage: number | null }[];
  subjects: { subjectId: string; name: string; points: { key: string; assessmentAverage: number | null; marks: number; termResult: number | null }[] }[] };

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const bucketLabel = (start: string, period: string) => period === 'month' ? monthName(start) : `Week of ${shortDate(start)}`;
const tone = (n: number | null) => n === null ? 'neutral' : n >= 70 ? 'positive' : n >= 50 ? 'caution' : 'critical';
// A percentage with a small bar, so a row of weeks reads as a trend at a glance.
const Score = ({ value, sub }: { value: number | null; sub?: string }) => value === null ? <span className="muted">–</span>
  : <span className="trend-cell"><span className={`trend-value tone-${tone(value)}`}>{value}%</span><span className="trend-bar"><span className={`trend-fill fill-${tone(value)}`} style={{ width: `${Math.min(100, value)}%` }}/></span>{sub && <span className="sub">{sub}</span>}</span>;

export function Progress({ schoolId, csrfToken, role, initialTab }: { schoolId: string; csrfToken: string; role: string; initialTab?: string }) {
  const head = role === 'headteacher';
  const [subjects, setSubjects] = useState<Subject[]>([]); const [terms, setTerms] = useState<Term[]>([]); const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState(''); const [termId, setTermId] = useState(''); const [subjectId, setSubjectId] = useState('');
  const [tab, setTab] = useState<'results' | 'trends' | 'gaps' | 'support' | 'mocks' | 'practice'>(initialTab === 'support' ? 'support' : initialTab === 'trends' ? 'trends' : 'results');
  // Support plans: every plan this person can see (for the due-review banner), and the ones shown on the Support tab.
  const [plans, setPlans] = useState<{ today: string; items: Plan[] } | null>(null); const [planScope, setPlanScope] = useState<'class' | 'school'>(head ? 'school' : 'class'); const [planStatus, setPlanStatus] = useState<'open' | 'closed'>('open');
  const [draft, setDraft] = useState<PlanDraft | null>(null); const [practiceFor, setPracticeFor] = useState(''); const [planId, setPlanId] = useState('');
  const [gaps, setGaps] = useState<{ items: Gap[]; untaggedAssessments: number } | null>(null);
  const [results, setResults] = useState<Results | null>(null); const [progress, setProgress] = useState<ClassProgress | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [learnerId, setLearnerId] = useState(''); const [roster, setRoster] = useState<{ learnerId: string; fullName: string }[]>([]);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);

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
    setResults(null); setProgress(null); setRoster([]); setGaps(null);
    if (!classId || !termId) return;
    try {
      const [a, p, g, gp] = await Promise.all([
        // A school with no grading policy yet has no term results to show.
        request<Results>(`/schools/${schoolId}/assessment/classes/${classId}/results?termId=${termId}`).catch(() => null),
        request<ClassProgress>(`/schools/${schoolId}/assessment/classes/${classId}/progress?termId=${termId}&period=${period}`),
        request<Page<{ learnerId: string; fullName: string }>>(`/schools/${schoolId}/assessment/classes/${classId}/grid?termId=${termId}`),
        request<{ items: Gap[]; untaggedAssessments: number }>(`/schools/${schoolId}/assessment/classes/${classId}/gaps?termId=${termId}${subjectId ? `&subjectId=${subjectId}` : ''}`)]);
      if (current !== latest.current) return;
      setResults(a); setProgress(p); setRoster(g.items); setGaps(gp);
    } catch (e) { if (current === latest.current) setError((e as Error).message); }
  }, [schoolId, classId, termId, subjectId, period]);
  useEffect(() => { void load(); }, [load]);

  const loadPlans = useCallback(async () => {
    try { setPlans(await request<{ today: string; items: Plan[] }>(`/schools/${schoolId}/support-plans?status=all`)); } catch (e) { setError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void loadPlans(); }, [loadPlans]);
  const due = plans?.items.filter(p => p.due) ?? [];
  const shownPlans = (plans?.items ?? []).filter(p => (planStatus === 'closed' ? p.closed : !p.closed) && (planScope === 'school' || p.class_id === classId));
  const planFor = (d: PlanDraft) => { setMessage(''); setDraft(d); };

  // Mock exams are a JHS matter (BECE preparation).
  const isJhs = (classes.find(c => c.id === classId)?.level ?? 'JHS') === 'JHS';
  useEffect(() => { if (!isJhs && tab === 'mocks') setTab('results'); }, [isJhs, tab]);

  const attentionCount = progress?.attention.length ?? 0;
  // One row per learner, most flags first, then the lowest recent average.
  const flagged = Object.values((progress?.attention ?? []).reduce<Record<string, { learnerId: string; fullName: string; flags: ClassProgress['attention'] }>>((acc, a) => {
    (acc[a.learnerId] ??= { learnerId: a.learnerId, fullName: a.fullName, flags: [] }).flags.push(a); return acc; }, {}))
    .sort((a, b) => b.flags.length - a.flags.length || Math.min(...a.flags.map(f => f.recent)) - Math.min(...b.flags.map(f => f.recent)));
  // Headline figures use periods where most of the class (two thirds or more) has marks, so a remedial test given to
  // a group of learners does not stand in for the whole class.
  const lastOverall = progress?.overall.filter(o => o.average !== null && o.learners * 3 >= progress.classSize * 2).slice(-2) ?? [];
  const change = lastOverall.length === 2 ? Math.round((lastOverall[1]!.average! - lastOverall[0]!.average!) * 10) / 10 : null;
  return <section aria-label="Learner progress" className="page">
    <PageHeader eyebrow="Teaching" title="Performance" blurb="How each class and learner is doing: term results, week-by-week trends, weak topics and who needs support. Marks are recorded on the Assessment page."/>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {due.length > 0 && <div className="banner"><Icon name="event_upcoming"/><span><strong>{due.length} support review{due.length === 1 ? ' is' : 's are'} due.</strong> Check whether each plan is working and record what happens next.</span>
      <button type="button" className="secondary" onClick={() => { setPlanStatus('open'); setPlanScope(due.some(p => p.class_id !== classId) ? 'school' : 'class'); setTab('support'); }}>Review now</button></div>}
    <Card flush>
      <div className="toolbar">
        <label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
        <label>Term<select value={termId} onChange={e => setTermId(e.target.value)}><option value="">Choose a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.year_name}</option>)}</select></label>
        <Tabs label="Progress view" value={tab} onChange={setTab} options={[{ id: 'results', label: 'Term results' }, { id: 'trends', label: 'Trends' }, { id: 'gaps', label: 'Gaps' }, { id: 'support', label: `Support${plans ? ` (${plans.items.filter(p => !p.closed).length})` : ''}` }, { id: 'practice', label: 'Home practice' }, ...(isJhs ? [{ id: 'mocks' as const, label: 'Mocks' }] : [])]}/>
      </div>
      {!classId || !termId ? (loaded && <Empty title={classes.length ? 'Choose a class and term' : 'No classes yet'} hint={classes.length ? undefined : head ? 'Add classes in Settings first.' : 'You have no class assigned today.'}/>)
        : tab === 'results' ? (!results ? <p className="muted card-body" role="status">Loading…</p>
          : !results.items.some(r => r.subjects.some(s => s.total !== null)) ? <Empty title="No term results yet" hint="Results appear once class work and exam marks are recorded on the Assessment page."/>
          : (() => { const names = results.items[0]?.subjects.map(s => ({ id: s.subjectId, name: s.name })) ?? [];
            const rows = [...results.items].filter(r => !r.left).sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.fullName.localeCompare(b.fullName));
            const averages = rows.filter(r => r.average !== null).map(r => r.average!);
            return <>
              <div className="stats card-body">
                <Stat label="Class average" value={averages.length ? `${Math.round(averages.reduce((a, b) => a + b, 0) / averages.length * 10) / 10}%` : '–'} caption={`${averages.length} of ${rows.length} learners with every subject`} icon="insights" tone={tone(averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : null)}/>
                <Stat label="Below 50% overall" value={averages.filter(a => a < 50).length} caption="Average of all subjects" icon="flag" tone={averages.some(a => a < 50) ? 'caution' : 'neutral'}/>
              </div>
              <div className="table-wrap"><table className="ca-sheet"><thead><tr><th className="num">Position</th><th>Learner</th>{names.map(n => <th key={n.id} className="num">{n.name}</th>)}<th className="num">Average</th></tr></thead><tbody>
                {rows.map(r => <tr key={r.learnerId}><td className="num">{r.position ?? '–'}</td><td><a className="learner-link" href={`#/learner/${r.learnerId}`}>{r.fullName}</a>{!r.complete && <span className="sub">Some marks missing</span>}</td>
                  {r.subjects.map(s => <td key={s.subjectId} className="num">{s.total === null ? <span className="muted">–</span> : <span className={`tone-${tone(s.total)}`}>{s.total}</span>}{s.grade && <span className="sub">{s.grade}</span>}</td>)}
                  <td className="num">{r.average === null ? <span className="muted">–</span> : <strong className={`tone-${tone(r.average)}`}>{r.average}</strong>}</td></tr>)}</tbody></table></div>
              <p className="muted card-body">Each subject's total is the CA from class work ({results.policy.caWeight}%) plus the exam ({results.policy.examWeight}%), from the marks recorded so far on the Assessment page. Positions count learners with every subject complete. These are working results until the headteacher publishes the report cards.</p>
            </>; })())
        : tab === 'practice' ? <ClassHomePractice key={`${classId}:${termId}`} schoolId={schoolId} classId={classId} termId={termId} earlyYears={['Nursery', 'KG'].includes(classes.find(c => c.id === classId)?.level ?? '')}/>
        : tab === 'mocks' && isJhs ? <Mocks key={classId} schoolId={schoolId} csrfToken={csrfToken} classId={classId} termId={termId} subjects={subjects} mode="view"
          onPlan={(id, subject, concern) => planFor({ subjectId: subject, learnerIds: [id], concern })}/>
        : tab === 'support' ? <>
          <div className="toolbar"><Tabs label="Plan status" value={planStatus} onChange={setPlanStatus} options={[{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }]}/>
            <Tabs label="Which classes" value={planScope} onChange={setPlanScope} options={[{ id: 'class', label: 'This class' }, { id: 'school', label: head ? 'Whole school' : 'All my classes' }]}/>
            <button type="button" className="secondary" disabled={!roster.length || !subjects.length} onClick={() => planFor({ subjectId: subjectId || subjects[0]!.id, learnerIds: [], concern: '' })}><Icon name="add"/>New plan</button></div>
          {!plans ? <p className="muted card-body" role="status">Loading…</p> : <SupportList plans={shownPlans} today={plans.today} showClass={planScope === 'school'} onOpen={setPlanId}/>}
        </> : tab === 'gaps' ? <>
          <div className="toolbar"><label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">All subjects</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><span className="count">Weakest first</span></div>
          {!gaps ? <p className="muted card-body" role="status">Loading…</p> : !gaps.items.length ? <Empty title="No indicators tested yet this term" hint={head ? 'Add your curriculum topics on the Curriculum page, then tag them when adding class work on the Assessment page.' : 'Tag curriculum indicators when you add class work on the Assessment page to see which ones the class has not mastered.'}/>
            : <div className="table-wrap"><table><thead><tr><th>Indicator</th><th>Class average</th><th>Below 50%</th><th>Learners below 50%</th></tr></thead><tbody>
              {gaps.items.map(g => <tr key={g.indicatorId}><td>{g.code && <strong>{g.code} </strong>}{g.description}<span className="sub">{[g.subject, g.strand, g.subStrand].filter(Boolean).join(' · ')} · {g.assessments} assessment{g.assessments === 1 ? '' : 's'}</span>
                  <button type="button" className={g.resources ? 'secondary small' : 'link-button small-link'} onClick={() => setPracticeFor(g.indicatorId)}>{g.resources ? `Practice (${g.resources})` : 'Add practice'}</button></td>
                <td><Score value={g.average}/></td><td className="num">{g.belowPass} of {g.learners}{g.belowShare !== null && <span className="sub">{g.belowShare}%</span>}</td>
                <td>{g.below.length ? <><span className="chip-list">{g.below.map(b => <button key={b.learnerId} type="button" className="link-button" onClick={() => setLearnerId(b.learnerId)}>{b.fullName} ({b.average}%)</button>)}</span>
                  {(() => {
                    // Learners already in an open plan for this topic in this class are not offered again.
                    const open = plans?.items.filter(p => !p.closed && p.class_id === classId && p.indicator_id === g.indicatorId) ?? [];
                    const covered = new Set(open.flatMap(p => p.learners.map(l => l.id))), rest = g.below.filter(b => !covered.has(b.learnerId));
                    return <span className="row-actions">{open.length > 0 && <button type="button" className="link-button small-link" onClick={() => setPlanId(open[0]!.id)}>Plan open for {g.below.length - rest.length}</button>}
                      {rest.length > 0 && <button type="button" className="secondary small" onClick={() => planFor({ subjectId: g.subjectId, indicatorId: g.indicatorId, indicatorLabel: g.code ?? g.description, learnerIds: rest.map(b => b.learnerId),
                        concern: `Below 50% on ${g.code ? `${g.code} ` : ''}${g.description} (class average ${g.average}%) across ${g.assessments} assessment${g.assessments === 1 ? '' : 's'} this term.` })}>Plan support for {rest.length}{open.length ? ' more' : ''}</button>}</span>;
                  })()}</> : <span className="muted">None</span>}</td></tr>)}</tbody></table></div>}
          {gaps && gaps.untaggedAssessments > 0 && <p className="muted card-body">{gaps.untaggedAssessments} assessment(s) this term have no indicators tagged, so they are not counted here.</p>}
        </> : <>
          <div className="toolbar"><Tabs label="Group by" value={period} onChange={setPeriod} options={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]}/>
            <label>Learner<select value={learnerId} onChange={e => setLearnerId(e.target.value)}><option value="">View one learner…</option>{roster.map(l => <option key={l.learnerId} value={l.learnerId}>{l.fullName}</option>)}</select></label></div>
          {!progress ? <p className="muted card-body" role="status">Loading…</p> : !progress.buckets.length ? <Empty title="No marks recorded yet this term" hint="Trends appear once class work is marked on the Assessment page."/>
            : <div className="table-wrap"><table className="trend-table"><thead><tr><th>Subject</th>{progress.buckets.map(b => <th key={b}>{bucketLabel(b, period)}</th>)}</tr></thead><tbody>
              {progress.subjects.map(s => <tr key={s.subjectId}><td>{s.name}</td>{s.points.map(p => <td key={p.start}><Score value={p.average} sub={p.marks ? `${p.marks} mark${p.marks === 1 ? '' : 's'}` : undefined}/></td>)}</tr>)}
              <tr className="trend-total"><td>All subjects</td>{progress.overall.map(o => <td key={o.start}><Score value={o.average}/></td>)}</tr></tbody></table></div>}
        </>}
    </Card>
    {tab === 'trends' && progress && progress.buckets.length > 0 && <>
      <div className="stats">
        <Stat label="Class average" value={lastOverall.length ? `${lastOverall[lastOverall.length - 1]!.average}%` : '–'} caption={lastOverall.length ? bucketLabel(lastOverall[lastOverall.length - 1]!.start, period) : `Latest ${period}`} icon="insights" tone={tone(lastOverall[lastOverall.length - 1]?.average ?? null)}/>
        <Stat label={`Change on previous ${period}`} value={change === null ? '–' : `${change > 0 ? '+' : ''}${change}`} caption="Percentage points" icon={change !== null && change < 0 ? 'trending_down' : 'trending_up'} tone={change === null ? 'neutral' : change < 0 ? 'critical' : 'positive'}/>
        <Stat label="Learners needing attention" value={flagged.length} caption={`${attentionCount} subject flag${attentionCount === 1 ? '' : 's'}`} icon="flag" tone={flagged.length ? 'caution' : 'neutral'}/>
      </div>
      <Card title="Needs attention" hint={`Last 3 marks in a subject average below 50%, or are 10 or more points below the learner's earlier marks this term. Most flags first.`} flush>
        {!attentionCount ? <Empty title="Nobody flagged" hint="Every learner with three or more marks is holding steady."/>
          : <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Subjects</th></tr></thead><tbody>
            {flagged.map(f => <tr key={f.learnerId}><td><button type="button" className="link-button" onClick={() => setLearnerId(f.learnerId)}>{f.fullName}</button><span className="sub">{f.flags.length} subject{f.flags.length === 1 ? '' : 's'}</span></td>
              <td><ul className="flag-list">{f.flags.map(a => <li key={a.subjectId}><span className="flag-subject">{a.subject}</span>
                <Pill tone={a.reason === 'dropping' ? 'critical' : 'caution'}>{a.reason === 'dropping' ? `Dropping ${a.earlier}% → ${a.recent}%` : `Below 50%: ${a.recent}%`}</Pill>
                {plans?.items.some(p => !p.closed && p.subject_name === a.subject && p.learners.some(l => l.id === a.learnerId)) ? <Pill tone="info">Plan open</Pill>
                  : <button type="button" className="secondary small" onClick={() => planFor({ subjectId: a.subjectId, learnerIds: [a.learnerId], concern: a.reason === 'dropping' ? `${a.subject}: last 3 marks average ${a.recent}%, down from ${a.earlier}% earlier this term.` : `${a.subject}: last 3 marks average ${a.recent}%, below 50%.` })}>Plan</button>}</li>)}</ul></td></tr>)}</tbody></table></div>}
      </Card>
    </>}
    {draft && <SupportPlanDialog schoolId={schoolId} csrfToken={csrfToken} classId={classId} termId={termId} draft={draft} subjects={subjects} roster={roster} onClose={() => setDraft(null)}
      onSaved={id => { setDraft(null); setMessage('Support plan started.'); void loadPlans(); setPlanId(id); }}/>}
    {planId && <SupportPlanDrawer schoolId={schoolId} csrfToken={csrfToken} planId={planId} onClose={() => setPlanId('')} onChanged={() => void loadPlans()}
      onFollowUp={({ classId: planClass, ...d }) => { setPlanId(''); if (planClass !== classId) setClassId(planClass); planFor(d); }}/>}
    {practiceFor && <PracticeDialog schoolId={schoolId} csrfToken={csrfToken} indicatorId={practiceFor} onClose={() => setPracticeFor('')} onChanged={() => void load()}/>}
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
    {data && <p className="muted">{data.learner.admissionNumber} · <a className="learner-link" href={`#/learner/${learnerId}`}>Open the full learner page</a></p>}
    <Tabs label="Group by" value={period} onChange={setPeriod} options={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }, { id: 'term', label: 'Termly' }, { id: 'year', label: 'Yearly' }]}/>
    {error && <p role="alert">{error}</p>}
    {data && (!data.buckets.length ? <Empty title="Nothing recorded yet" hint="Marks and term results appear here as they are entered."/>
      : <div className="table-wrap"><table className="trend-table"><thead><tr><th>Subject</th>{data.buckets.map(b => <th key={b.key}>{label(b)}</th>)}</tr></thead><tbody>
        {data.subjects.map(s => <tr key={s.subjectId}><td>{s.name}</td>{s.points.map(p => <td key={p.key}>{withResults && p.termResult !== null ? <Score value={p.termResult} sub={p.assessmentAverage !== null ? `Assessments ${p.assessmentAverage}%` : 'Term result'}/> : <Score value={p.assessmentAverage} sub={p.marks ? `${p.marks} mark${p.marks === 1 ? '' : 's'}` : undefined}/>}</td>)}</tr>)}
        <tr className="trend-total"><td>All assessments</td>{data.overall.map(o => <td key={o.key}><Score value={o.assessmentAverage}/></td>)}</tr></tbody></table></div>)}
    {withResults && <p className="muted">Termly and yearly cells show the term result (class score and exam, weighted by the school's policy) where it has been recorded, with the average of that term's assessments beneath.</p>}
  </Dialog>;
}
