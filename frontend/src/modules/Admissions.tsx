import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { takeFind } from '../lib/find';
import { LearnerImports } from './LearnerImports';
import { LearnerUpdates, fieldLabel } from './LearnerUpdates';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Tabs } from '../lib/ui';
import { Promotion } from './Promotion';
import { BlankAdmissionForm } from './AdmissionPage';
import { nextStep, statusNames, statusTone } from '../lib/admissions';

type Role = 'headteacher' | 'frontdesk' | string;
type AcademicYear = { id: string; name: string; start_date: string; end_date: string };
type SchoolClass = { id: string; name: string; level: 'Nursery' | 'KG' | 'Primary' | 'JHS'; capacity: number; academic_year_id: string; year_name: string; start_date: string; end_date: string };
type Admission = { id: string; full_name: string; date_of_birth?: string | null; status: string; class_id: string; class_name: string; start_date: string; admission_number: string; version: number; learner_id?: string | null; decision_reason?: string | null };
type Learner = { id: string; full_name: string; admission_number: string; date_of_birth?: string | null; sex?: 'female' | 'male' | null; version: number; class_name?: string | null; left_on?: string | null };
type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type Enrolment = { id: string; class_id: string; class_name: string; start_date: string; end_date?: string | null; end_reason?: string | null; superseded_at?:string | null; supersession_reason?:string | null };
type LearnerDetail = Learner & { enrolments: Enrolment[] };
type Props = { schoolId: string; csrfToken: string; role: Role; view?: 'setup' | 'work'; initialTab?: 'roll' | 'applications' | 'promotion' };

const levels: SchoolClass['level'][] = ['Nursery', 'KG', 'Primary', 'JHS'];
const dateToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
const classYearQuery = (year: string) => year === 'all' ? '' : `&academicYearId=${year}`;

export function Admissions({ schoolId, csrfToken, role, view, initialTab = 'roll' }: Props) {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [yearsTotal, setYearsTotal] = useState(0);
  const [classesTotal, setClassesTotal] = useState(0);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [admissionsTotal, setAdmissionsTotal] = useState(0);
  const [learnersTotal, setLearnersTotal] = useState(0);
  const [admissionsOffset, setAdmissionsOffset] = useState(0);
  const [learnersOffset, setLearnersOffset] = useState(0);
  const [admissionsSearchInput, setAdmissionsSearchInput] = useState('');
  const [admissionsSearch, setAdmissionsSearch] = useState('');
  // The Admissions tab opens on applications still being decided; enrolled and declined ones are a choice away.
  const [stage, setStage] = useState<'open' | 'enrolled' | 'declined' | 'all'>('open');
  // A search from the top bar opens the roll already filtered to that student.
  const [found] = useState(() => takeFind('students')?.text ?? '');
  const [learnersSearchInput, setLearnersSearchInput] = useState(found);
  const [learnersSearch, setLearnersSearch] = useState(found);
  const [detail, setDetail] = useState<LearnerDetail | null>(null);
  const [corrections, setCorrections] = useState<{ id: string; field: keyof typeof fieldLabel; old_value: string | null; new_value: string; reason: string; recorded_at: string }[]>([]);
  const [selectedLearner, setSelectedLearner] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'roll' | 'applications' | 'promotion'>(initialTab);
  const [dialog, setDialog] = useState<'' | 'application' | 'import' | 'update' | 'census' | 'blank'>('');
  const [census, setCensus] = useState<{ day: string; items: { id: string; name: string; female: number; male: number; unrecorded: number }[] } | null>(null);
  const [enrolledToday, setEnrolledToday] = useState<Record<string, number>>({});
  const [classYear, setClassYear] = useState('');
  const [classList, setClassList] = useState<{ key: string; items: SchoolClass[]; total: number } | null>(null);
  const [classesVersion, setClassesVersion] = useState(0);
  const selectedLearnerRef=useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transfer, setTransfer] = useState({ classId: '', effectiveDate: dateToday(), reason: '' });
  const [withdrawalOpen,setWithdrawalOpen]=useState(false);
  const [withdrawal,setWithdrawal]=useState({effectiveDate:dateToday(),reason:''});
  const blankApplication = { fullName: '', dateOfBirth: '', sex: '', classId: '', startDate: dateToday(), admissionNumber: '', guardianName: '', guardianRelationship: '', guardianPhone: '' };
  const [application, setApplication] = useState(blankApplication);
  const [newYear, setNewYear] = useState({ name: '', startDate: '', endDate: '' });
  const [newClass, setNewClass] = useState({ name: '', level: 'Primary' as SchoolClass['level'], capacity: '', academicYearId: '' });
  const operations = useRef(new Map<string, { payload: string; id: string }>());
  const learnerEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const workspaceEpoch = useRef(0);
  const alive = useRef(true);

  // The Classes page shows one academic year at a time: the year running today unless the head picks another, or "all".
  const today = dateToday();
  const runningYear = years.find(y => y.start_date <= today && today < y.end_date);
  const activeYear = classYear || (runningYear ?? years[0])?.id || 'all';
  const activeYearName = years.find(y => y.id === activeYear)?.name ?? '';
  const classFormYear = newClass.academicYearId || (activeYear === 'all' ? '' : activeYear);

  const operationId = (key: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    const prior = operations.current.get(key);
    if (prior?.payload === serialized) return prior.id;
    const next = { payload: serialized, id: crypto.randomUUID() };
    operations.current.set(key, next);
    return next.id;
  };

  const loadWorkspace = useCallback(async (initial = false, resetAdmissions = false) => {
    const epoch = ++workspaceEpoch.current;
    if (initial) setLoading(true);
    setError('');
    try {
      const admissionQuery = new URLSearchParams({ offset: String(resetAdmissions ? 0 : admissionsOffset), limit: '25' });
      const learnerQuery = new URLSearchParams({ offset: String(learnersOffset), limit: '25' });
      if (admissionsSearch.trim()) admissionQuery.set('search', admissionsSearch.trim());
      if (stage !== 'all') admissionQuery.set('stage', stage);
      if (learnersSearch.trim()) learnerQuery.set('search', learnersSearch.trim());
      const [yearRows, classRows, admissionRows, learnerRows] = await Promise.all([
        request<Page<AcademicYear>>(`/schools/${schoolId}/academic-years?limit=100`),
        request<Page<SchoolClass>>(`/schools/${schoolId}/classes?limit=100`),
        request<Page<Admission>>(`/schools/${schoolId}/admissions?${admissionQuery.toString()}`),
        request<Page<Learner>>(`/schools/${schoolId}/learners?${learnerQuery.toString()}`),
      ]);
      if (!alive.current || workspaceEpoch.current !== epoch) return;
      setYears(yearRows.items); setYearsTotal(yearRows.total); setClasses(classRows.items); setClassesTotal(classRows.total); setAdmissions(admissionRows.items); setAdmissionsTotal(admissionRows.total); setLearners(learnerRows.items); setLearnersTotal(learnerRows.total);
    } catch (e) { if (alive.current && workspaceEpoch.current === epoch) setError((e as Error).message); }
    finally { if (alive.current && workspaceEpoch.current === epoch && initial) setLoading(false); }
  }, [schoolId, admissionsOffset, admissionsSearch, stage, learnersOffset, learnersSearch]);

  const loadMore = async (kind: 'academic-years' | 'classes') => {
    const loaded = kind === 'classes' ? classList?.items.length ?? 0 : years.length;
    try {
      if (kind === 'classes') { const key = activeYear; const page = await request<Page<SchoolClass>>(`/schools/${schoolId}/classes?limit=100&offset=${loaded}${classYearQuery(key)}`); if (alive.current) setClassList(prior => prior?.key === key ? { key, items: [...prior.items, ...page.items], total: page.total } : prior); }
      else { const page = await request<Page<AcademicYear>>(`/schools/${schoolId}/academic-years?limit=100&offset=${loaded}`); if (alive.current) { setYears(prior => [...prior, ...page.items]); setYearsTotal(page.total); } }
    } catch (e) { if (alive.current) setError((e as Error).message); }
  };

  // The Classes page shows how many students each class has today.
  useEffect(() => {
    if (view !== 'setup') return;
    void request<{ items: { id: string; female: number; male: number; unrecorded: number }[] }>(`/schools/${schoolId}/learners/census`)
      .then(r => setEnrolledToday(Object.fromEntries(r.items.map(i => [i.id, i.female + i.male + i.unrecorded])))).catch(() => undefined);
  }, [schoolId, view]);
  useEffect(() => {
    if (view !== 'setup' || loading) return;
    let current = true;
    void request<Page<SchoolClass>>(`/schools/${schoolId}/classes?limit=100${classYearQuery(activeYear)}`)
      .then(page => { if (current && alive.current) setClassList({ key: activeYear, items: page.items, total: page.total }); })
      .catch(e => { if (current && alive.current) setError((e as Error).message); });
    return () => { current = false; };
  }, [schoolId, view, loading, activeYear, classesVersion]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; learnerEpoch.current++; detailEpoch.current++; workspaceEpoch.current++; };
  }, [schoolId]);

  useEffect(() => {
    void loadWorkspace(true);
    return () => { workspaceEpoch.current++; };
  }, [loadWorkspace]);

  useEffect(() => {
    const epoch = ++learnerEpoch.current;
    detailEpoch.current++;selectedLearnerRef.current=selectedLearner;
    setDetail(null);setCorrections([]);
    setWithdrawalOpen(false);setWithdrawal({effectiveDate:dateToday(),reason:''});
    if (!selectedLearner) return;
    void request<LearnerDetail>(`/schools/${schoolId}/learners/${selectedLearner}`).then(row => {
      if (alive.current && learnerEpoch.current === epoch) setDetail(row);
    }).catch(e => { if (alive.current && learnerEpoch.current === epoch) setError((e as Error).message); });
    void request<{ items: typeof corrections }>(`/schools/${schoolId}/learners/${selectedLearner}/corrections`).then(r => { if (alive.current && learnerEpoch.current === epoch) setCorrections(r.items); }).catch(() => undefined);
  }, [schoolId, selectedLearner]);

  async function send(key: string, payload: Record<string, unknown>, url: string, successText: string) {
    const learnerAtStart = selectedLearner;
    setBusy(true); setError(''); setNotice('');
    const body = { ...payload, operationId: operationId(key, payload) };
    try {
      await request(url, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) });
      if(!alive.current)return false;
      operations.current.delete(key);
      setNotice(successText);
      setAdmissionsOffset(0);
      await loadWorkspace(false, true);
      if (learnerAtStart && selectedLearnerRef.current === learnerAtStart) {
        const epoch = ++detailEpoch.current;
        const row = await request<LearnerDetail>(`/schools/${schoolId}/learners/${learnerAtStart}`);
        if (alive.current && selectedLearnerRef.current === learnerAtStart && detailEpoch.current === epoch) setDetail(row);
      }
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }

  async function submitApplication(event: React.FormEvent) {
    event.preventDefault();
    const guardian = application.guardianName.trim();
    const payload = { fullName: application.fullName.trim(), ...(application.dateOfBirth ? { dateOfBirth: application.dateOfBirth } : {}), ...(application.sex ? { sex: application.sex } : {}), classId: application.classId, startDate: application.startDate, admissionNumber: application.admissionNumber.trim(),
      ...(guardian ? { guardianName: guardian, ...(application.guardianRelationship ? { guardianRelationship: application.guardianRelationship } : {}), ...(application.guardianPhone.trim() ? { guardianPhone: application.guardianPhone.trim() } : {}) } : {}) };
    if (await send('application', payload, `/schools/${schoolId}/admissions`, 'Application recorded. Open it to review and decide.')) { setApplication(blankApplication); setDialog(''); setTab('applications'); }
  }

  async function createYear(event: React.FormEvent) {
    event.preventDefault();
    const payload = { name: newYear.name.trim(), startDate: newYear.startDate, endDate: newYear.endDate };
    if (await send('academic-year', payload, `/schools/${schoolId}/academic-years`, 'Academic year added.')) setNewYear({ name: '', startDate: '', endDate: '' });
  }

  async function createClass(event: React.FormEvent) {
    event.preventDefault();
    const payload = { name: newClass.name.trim(), level: newClass.level, capacity: Number(newClass.capacity), academicYearId: classFormYear };
    if (await send('class', payload, `/schools/${schoolId}/classes`, 'Class added.')) { setNewClass({ name: '', level: 'Primary', capacity: '', academicYearId: '' }); setClassesVersion(v => v + 1); }
  }

  async function transferLearner(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const payload = { version: detail.version, classId: transfer.classId, effectiveDate: transfer.effectiveDate, reason: transfer.reason.trim() };
    if (await send(`transfer:${detail.id}`, payload, `/schools/${schoolId}/learners/${detail.id}/transfer`, 'Transfer recorded. Previous enrolment history is retained.')) setTransfer({ classId: '', effectiveDate: dateToday(), reason: '' });
  }

  async function withdrawLearner(event:React.FormEvent) {
    event.preventDefault();if(!detail)return;
    const payload={version:detail.version,effectiveDate:withdrawal.effectiveDate,reason:withdrawal.reason.trim()};
    if(await send(`withdraw:${detail.id}`,payload,`/schools/${schoolId}/learners/${detail.id}/withdraw`,'Withdrawal recorded. Student and class history are retained.'))setWithdrawalOpen(false);
  }

  const messages = <>{error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}</>;
  const classLabel = (c: SchoolClass) => `${c.name} · ${c.level} · ${c.year_name}`;
  const pager = (offset: number, shown: number, total: number, noun: string, move: (offset: number) => void) => <div className="pager" aria-label={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} pages`}>
    <span>{total === 0 ? `0 ${noun}` : `Showing ${offset + 1}–${Math.min(offset + shown, total)} of ${total} ${noun}`}</span>
    <div><button type="button" className="secondary" disabled={busy || offset === 0} onClick={() => move(Math.max(0, offset - 25))}>Previous {noun}</button><button type="button" className="secondary" disabled={busy || offset + shown >= total} onClick={() => move(offset + 25)}>Next {noun}</button></div>
  </div>;

  if (view === 'setup') return <section aria-labelledby="admissions-title" className="page">
    <PageHeader id="admissions-title" eyebrow="School" title="Classes" blurb="Your academic years and classes. Teachers are given their classes on the Teachers page."/>
    {messages}
    {loading ? <p role="status">Loading academic years and classes…</p> : <>
      <Card title="Classes" hint={activeYear === 'all' ? 'Every year, newest first.' : 'Choose another year to see its classes.'} flush>
        <div className="toolbar">
          <label>Year<select value={activeYear} onChange={e => setClassYear(e.target.value)}>{years.map(y => <option key={y.id} value={y.id}>{y.name}{y.id === runningYear?.id ? ' (this year)' : ''}</option>)}<option value="all">All years</option></select></label>
          {classList?.key === activeYear && <span className="count">{classList.total} {classList.total === 1 ? 'class' : 'classes'}</span>}
        </div>
        {classList?.key !== activeYear ? <p className="card-body" role="status">Loading classes…</p> : classList.items.length ? <div className="table-wrap"><table><thead><tr><th>Class</th><th>Level</th>{activeYear === 'all' && <th>Year</th>}<th className="num" title="Enrolled today">Students</th><th className="num">Capacity</th></tr></thead><tbody>{classList.items.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.level}</td>{activeYear === 'all' && <td>{c.year_name}</td>}<td className="num" title={c.start_date <= today && today < c.end_date ? undefined : 'This year is not running today'}>{c.start_date <= today && today < c.end_date ? enrolledToday[c.id] ?? 0 : '—'}</td><td className="num">{c.capacity}</td></tr>)}</tbody></table></div> : <Empty title={activeYear === 'all' ? 'No classes recorded' : `No classes in ${activeYearName} yet`} hint="Add one below."/>}
        {classList?.key === activeYear && classList.items.length < classList.total && <p className="card-body">Showing {classList.items.length} of {classList.total} classes, newest year first. <button type="button" className="secondary" onClick={() => void loadMore('classes')}>Show more classes</button></p>}
        <form onSubmit={createClass} className="card-body"><h4>Add class</h4><div className="grid"><label>Class name<input value={newClass.name} onChange={e => setNewClass({ ...newClass, name: e.target.value })} required maxLength={80} placeholder="Primary 1 Blue"/></label><label>Level<select value={newClass.level} onChange={e => setNewClass({ ...newClass, level: e.target.value as SchoolClass['level'] })}>{levels.map(level => <option key={level}>{level}</option>)}</select></label><label>Capacity<input type="number" min="1" max="500" step="1" value={newClass.capacity} onChange={e => setNewClass({ ...newClass, capacity: e.target.value })} required/></label><label>Academic year<select value={classFormYear} onChange={e => setNewClass({ ...newClass, academicYearId: e.target.value })} required><option value="">Choose an academic year</option>{years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label></div><button disabled={busy || !years.length}>Add class</button></form>
      </Card>
      <Card title="Academic years" hint="End dates are exclusive: the first day after the year ends." flush>
        {years.length ? <div className="table-wrap"><table><thead><tr><th>Year</th><th>Starts</th><th>Ends (exclusive)</th></tr></thead><tbody>{years.map(y => <tr key={y.id}><td>{y.name}</td><td>{y.start_date}</td><td>{y.end_date}</td></tr>)}</tbody></table></div> : <Empty title="No academic years recorded"/>}
        {years.length < yearsTotal && <p>Showing {years.length} of {yearsTotal} academic years. <button type="button" className="secondary" onClick={() => void loadMore('academic-years')}>Show more years</button></p>}
        <form onSubmit={createYear} className="card-body"><h4>Add academic year</h4><div className="grid"><label>Year name<input value={newYear.name} onChange={e => setNewYear({ ...newYear, name: e.target.value })} required maxLength={80} placeholder="2026/2027"/></label><label>Start date<input type="date" value={newYear.startDate} onChange={e => setNewYear({ ...newYear, startDate: e.target.value })} required/></label><label>End date (exclusive)<input type="date" value={newYear.endDate} onChange={e => setNewYear({ ...newYear, endDate: e.target.value })} required/></label></div><button disabled={busy}>Add academic year</button></form>
      </Card>
    </>}
  </section>;

  return <section aria-label="Admissions and students" className="page">
    <PageHeader eyebrow="People" title="Students" blurb="Every student record, application and class history in one place."
      actions={tab === 'promotion' ? undefined : <><button type="button" disabled={loading || !classes.length} onClick={() => { setError(''); setNotice(''); setDialog('application'); }}><Icon name="person_add"/>New application</button><button type="button" className="secondary" onClick={() => setDialog('import')}><Icon name="upload_file"/>Import existing students</button><button type="button" className="secondary" onClick={() => setDialog('update')}><Icon name="edit_document"/>Update from CSV</button><button type="button" className="secondary" onClick={() => { setDialog('census'); setCensus(null); request<NonNullable<typeof census>>(`/schools/${schoolId}/learners/census`).then(setCensus).catch(e => setError((e as Error).message)); }}><Icon name="groups"/>Class sizes</button><button type="button" className="secondary" disabled={busy || loading} onClick={() => void loadWorkspace(true)}>Refresh records</button></>}/>
    {!dialog && !selectedLearner && messages}
    {loading ? <p role="status">Loading admissions and student records…</p> : <>
      <div className="actions"><Tabs label="Student lists" value={tab} onChange={setTab} options={[{ id: 'roll', label: `Student roll (${learnersTotal})` }, { id: 'applications', label: stage === 'open' ? `Admissions (${admissionsTotal} open)` : 'Admissions' }, ...(role === 'headteacher' ? [{ id: 'promotion' as const, label: 'Year-end promotion' }] : [])]}/></div>
      {tab === 'promotion' && role === 'headteacher' ? <Promotion schoolId={schoolId} csrfToken={csrfToken} embedded/> : tab === 'roll' ? <Card flush>
        <div className="toolbar">
          <form onSubmit={event => { event.preventDefault(); setLearnersOffset(0); setLearnersSearch(learnersSearchInput.trim()); }}>
            <label className="search"><span className="sr-only">Search students</span><Icon name="search"/><input type="search" aria-label="Search students" value={learnersSearchInput} onChange={event => setLearnersSearchInput(event.target.value)} placeholder="Search name or admission number"/></label>
            <button type="submit" className="secondary" disabled={busy}>Search</button>
          </form>
          <span className="count">{learnersTotal} students</span>
        </div>
        {learners.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Class</th><th className="hide-sm">Sex</th><th className="hide-sm">Date of birth</th><th className="hide-sm"></th></tr></thead><tbody>{learners.map(row => <tr key={row.id}>
          <td><button type="button" className="link-button" onClick={() => setSelectedLearner(row.id)}>{row.full_name}</button></td><td>{row.admission_number}</td><td>{row.class_name ?? (row.left_on ? `Left ${row.left_on}` : 'Not enrolled yet')}</td><td className="hide-sm">{row.sex === 'female' ? 'F' : row.sex === 'male' ? 'M' : '—'}</td><td className="hide-sm">{row.date_of_birth ?? '—'}</td>
          <td className="num hide-sm"><button type="button" className="secondary" aria-label={`Open ${row.full_name}`} onClick={() => setSelectedLearner(row.id)}>Open</button></td></tr>)}</tbody></table></div>
          : <Empty title={learnersSearch ? 'No students match this search' : 'No students yet'} hint={learnersSearch ? undefined : 'Record an application or import your class lists from Excel.'}/>}
        {pager(learnersOffset, learners.length, learnersTotal, 'students', setLearnersOffset)}
      </Card> : <Card flush>
        <div className="toolbar">
          <form onSubmit={event => { event.preventDefault(); setAdmissionsOffset(0); setAdmissionsSearch(admissionsSearchInput.trim()); }}>
            <label className="search"><span className="sr-only">Search applications</span><Icon name="search"/><input type="search" aria-label="Search applications" value={admissionsSearchInput} onChange={event => setAdmissionsSearchInput(event.target.value)} placeholder="Search name or admission number"/></label>
            <button type="submit" className="secondary" disabled={busy}>Search</button>
          </form>
          <label>Stage<select value={stage} onChange={e => { setAdmissionsOffset(0); setStage(e.target.value as typeof stage); }}><option value="open">Still being decided</option><option value="enrolled">Enrolled</option><option value="declined">Declined</option><option value="all">All stages</option></select></label>
          <span className="count">{admissionsTotal} applications</span>
          <button type="button" className="secondary" onClick={() => setDialog('blank')}><Icon name="print"/>Print blank form</button>
        </div>
        {admissions.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th className="hide-sm">Starts</th><th>Stage</th><th className="hide-sm">Next step</th><th className="hide-sm"></th></tr></thead><tbody>{admissions.map(row => <tr key={row.id}>
          <td><a className="learner-link" href={`#/admission/${row.id}`}>{row.full_name}</a><span className="sub">{row.admission_number}</span></td>
          <td>{row.class_name}</td><td className="hide-sm">{row.start_date}</td><td><Pill tone={statusTone[row.status] ?? 'neutral'}>{statusNames[row.status] ?? row.status}</Pill></td>
          <td className="hide-sm">{nextStep(row.status, row.class_name)}</td>
          <td className="num hide-sm"><a className="button secondary" href={`#/admission/${row.id}`} aria-label={`Open the application for ${row.full_name}`}>Open</a></td>
        </tr>)}</tbody></table></div> : <Empty title={admissionsSearch ? 'No applications match this search' : stage === 'open' ? 'No applications waiting for a decision' : 'No applications at this stage'}/>}
        {pager(admissionsOffset, admissions.length, admissionsTotal, 'applications', setAdmissionsOffset)}
      </Card>}
    </>}

    {dialog === 'census' && <Dialog title="Class sizes by sex" onClose={() => setDialog('')}>
      {!census ? <p role="status">Loading…</p> : <><p className="muted">Students enrolled on {census.day}, as the GES school census asks for them.</p>
        <div className="table-wrap"><table><thead><tr><th>Class</th><th className="num">Girls</th><th className="num">Boys</th><th className="num">Not recorded</th><th className="num">Total</th></tr></thead><tbody>
          {census.items.map(row => <tr key={row.id}><td>{row.name}</td><td className="num">{row.female}</td><td className="num">{row.male}</td><td className="num">{row.unrecorded}</td><td className="num">{row.female + row.male + row.unrecorded}</td></tr>)}
          <tr><td><strong>All classes</strong></td>{(['female', 'male', 'unrecorded'] as const).map(k => <td key={k} className="num"><strong>{census.items.reduce((sum, row) => sum + row[k], 0)}</strong></td>)}<td className="num"><strong>{census.items.reduce((sum, row) => sum + row.female + row.male + row.unrecorded, 0)}</strong></td></tr>
        </tbody></table></div>
        <div className="actions"><button type="button" onClick={() => window.print()}><Icon name="print"/>Print</button></div></>}
    </Dialog>}
    {dialog === 'application' && <Dialog title="New application" onClose={() => setDialog('')}>
      {messages}
      <form onSubmit={submitApplication}>
        <label>Student full name<input autoComplete="off" value={application.fullName} onChange={e => setApplication({ ...application, fullName: e.target.value })} required minLength={3} maxLength={120}/></label>
        <div className="grid"><label>Admission number<input value={application.admissionNumber} onChange={e => setApplication({ ...application, admissionNumber: e.target.value })} required minLength={2} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9/-]{1,39}"/></label>
        <label>Date of birth (optional)<input type="date" value={application.dateOfBirth} onChange={e => setApplication({ ...application, dateOfBirth: e.target.value })}/></label>
        <label>Sex<select value={application.sex} onChange={e => setApplication({ ...application, sex: e.target.value })}><option value="">Not recorded</option><option value="female">Female</option><option value="male">Male</option></select></label></div>
        <label>Intended class<select value={application.classId} onChange={e => setApplication({ ...application, classId: e.target.value })} required><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select></label>
        <label>Proposed start date<input type="date" value={application.startDate} onChange={e => setApplication({ ...application, startDate: e.target.value })} required/></label>
        <h4>Parent or guardian</h4>
        <div className="grid"><label>Name<input autoComplete="off" value={application.guardianName} onChange={e => setApplication({ ...application, guardianName: e.target.value })} minLength={2} maxLength={120} required={!!(application.guardianRelationship || application.guardianPhone.trim())}/></label>
        <label>Relationship<select value={application.guardianRelationship} onChange={e => setApplication({ ...application, guardianRelationship: e.target.value })}><option value="">Not recorded</option>{['Mother', 'Father', 'Grandparent', 'Aunt or uncle', 'Brother or sister', 'Other guardian'].map(r => <option key={r}>{r}</option>)}</select></label>
        <label>Mobile number<input type="tel" inputMode="tel" autoComplete="off" value={application.guardianPhone} onChange={e => setApplication({ ...application, guardianPhone: e.target.value })} placeholder="024 123 4567" pattern="[0-9 +()\-]{9,20}"/></label></div>
        <div className="actions"><button disabled={busy || !classes.length}>{busy ? 'Saving…' : 'Record application'}</button><button type="button" className="secondary" onClick={() => setDialog('')}>Cancel</button></div>
      </form>
    </Dialog>}
    {dialog === 'blank' && <Dialog title="Blank admission form" wide onClose={() => setDialog('')}>
      <BlankAdmissionForm schoolId={schoolId}/>
    </Dialog>}
    {dialog === 'update' && <Dialog title="Correct student records from a CSV" wide onClose={() => setDialog('')}>
      <LearnerUpdates schoolId={schoolId} csrfToken={csrfToken} role={role} onApplied={() => void loadWorkspace(false, true)}/>
    </Dialog>}
    {dialog === 'import' && <Dialog title="Import existing students" wide onClose={() => setDialog('')}>
      <LearnerImports schoolId={schoolId} csrfToken={csrfToken} role={role} inDialog onCommitted={() => loadWorkspace(false, true)} />
    </Dialog>}

    {selectedLearner && <Dialog title={detail?.full_name ?? 'Student'} drawer onClose={() => setSelectedLearner('')}>
      {messages}
      {!detail ? <p role="status">Loading student history…</p> : <div>
        {role === 'headteacher' && <p><a className="learner-link" href={`#/learner/${detail.id}`}>Open the full student page</a></p>}
        <p className="muted">Admission number {detail.admission_number}{detail.date_of_birth ? ` · Date of birth ${detail.date_of_birth}` : ''}</p>
        <label className="inline-field">Sex<select aria-label="Sex" value={detail.sex ?? ''} disabled={busy} onChange={e => e.target.value && void send('sex', { version: detail.version, sex: e.target.value }, `/schools/${schoolId}/learners/${detail.id}/sex`, 'Sex recorded.')}><option value="" disabled>Not recorded</option><option value="female">Female</option><option value="male">Male</option></select></label>
        {corrections.length > 0 && <><h4>Corrections</h4><ul className="history">{corrections.map(c => <li key={c.id}><strong>{fieldLabel[c.field]}: {c.old_value ?? 'not recorded'} → {c.new_value}</strong><span>{c.reason} · {c.recorded_at.slice(0, 10)}</span></li>)}</ul></>}
        <h4>Class history</h4>{detail.enrolments.length ? <ul className="history">{detail.enrolments.map(row => <li key={row.id}><strong>{row.class_name}</strong><span>{row.start_date}{row.end_date ? ` to ${row.end_date} (end exclusive)` : ' · Open-ended'} · {row.superseded_at ? `Superseded · ${row.supersession_reason}` : row.start_date > dateToday() ? 'Scheduled' : row.end_date && row.end_date <= dateToday() ? 'Ended' : 'Active today'}{row.end_reason ? ` · ${row.end_reason}` : ''}</span></li>)}</ul> : <p>No enrolments recorded.</p>}
        {detail.enrolments.some(row=>!row.end_date&&!row.superseded_at) ? <><form onSubmit={transferLearner}><h4>Transfer to another class</h4>
          <label>New class<select value={transfer.classId} onChange={e => setTransfer({ ...transfer, classId: e.target.value })} required><option value="">Choose a class</option>{classes.filter(c => !detail.enrolments.some(enrolment => enrolment.class_id === c.id && !enrolment.end_date && !enrolment.superseded_at)).map(c => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select></label>
          <div className="grid"><label>Effective date<input type="date" value={transfer.effectiveDate} onChange={e => setTransfer({ ...transfer, effectiveDate: e.target.value })} required/></label>
          <label>Transfer reason<input value={transfer.reason} onChange={e => setTransfer({ ...transfer, reason: e.target.value })} required maxLength={500}/></label></div>
          <button disabled={busy || !transfer.classId}>Record transfer</button>
        </form>
        <h4>Leaving the school</h4>
        <button type="button" className="secondary" aria-expanded={withdrawalOpen} disabled={busy} onClick={()=>setWithdrawalOpen(!withdrawalOpen)}>Withdraw student</button>
        {withdrawalOpen&&<form onSubmit={withdrawLearner}><h4>Record withdrawal</h4><p className="muted">The student leaves this class on the selected date. Previous records remain available. Scheduled transfers on or after this date are superseded, with their original history retained.</p>
          <label>Withdrawal date (first day out of class)<input type="date" value={withdrawal.effectiveDate} onChange={e=>setWithdrawal({...withdrawal,effectiveDate:e.target.value})} required/></label>
          <label>Withdrawal reason<input value={withdrawal.reason} onChange={e=>setWithdrawal({...withdrawal,reason:e.target.value})} required minLength={3} maxLength={500}/></label>
          <button disabled={busy}>Record withdrawal</button>
        </form>}</> : <p>No open enrolment. Previous student and class records are retained.</p>}
      </div>}
    </Dialog>}
  </section>;
}
