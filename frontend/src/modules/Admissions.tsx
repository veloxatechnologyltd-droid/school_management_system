import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { LearnerImports } from './LearnerImports';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Tabs, type Tone } from '../lib/ui';

type Role = 'headteacher' | 'frontdesk' | string;
type AcademicYear = { id: string; name: string; start_date: string; end_date: string };
type SchoolClass = { id: string; name: string; level: 'Nursery' | 'KG' | 'Primary' | 'JHS'; capacity: number; academic_year_id: string; year_name: string; start_date: string; end_date: string };
type Admission = { id: string; full_name: string; date_of_birth?: string | null; status: string; class_id: string; class_name: string; start_date: string; admission_number: string; version: number; learner_id?: string | null; decision_reason?: string | null };
type Learner = { id: string; full_name: string; admission_number: string; date_of_birth?: string | null; version: number };
type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type Enrolment = { id: string; class_id: string; class_name: string; start_date: string; end_date?: string | null; end_reason?: string | null; superseded_at?:string | null; supersession_reason?:string | null };
type LearnerDetail = Learner & { enrolments: Enrolment[] };
type Props = { schoolId: string; csrfToken: string; role: Role; view?: 'setup' | 'work' };

const levels: SchoolClass['level'][] = ['Nursery', 'KG', 'Primary', 'JHS'];
const statusNames: Record<string, string> = { application: 'Application', review: 'Under review', offered: 'Offered a place', waitlisted: 'Waitlisted', declined: 'Declined', accepted: 'Accepted', enrolled: 'Enrolled' };
const statusTone: Record<string, Tone> = { application: 'info', review: 'info', offered: 'caution', waitlisted: 'neutral', declined: 'critical', accepted: 'caution', enrolled: 'positive' };
const actionNames: Record<string, string> = { review: 'Start review', offer: 'Offer place', waitlist: 'Waitlist', decline: 'Decline', accept: 'Record acceptance', enrol: 'Enrol learner' };
const dateToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });

export function Admissions({ schoolId, csrfToken, role, view }: Props) {
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
  const [learnersSearchInput, setLearnersSearchInput] = useState('');
  const [learnersSearch, setLearnersSearch] = useState('');
  const [detail, setDetail] = useState<LearnerDetail | null>(null);
  const [selectedLearner, setSelectedLearner] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'roll' | 'applications'>('roll');
  const [dialog, setDialog] = useState<'' | 'application' | 'import'>('');
  const selectedLearnerRef=useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewReason, setReviewReason] = useState<Record<string, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [transfer, setTransfer] = useState({ classId: '', effectiveDate: dateToday(), reason: '' });
  const [withdrawalOpen,setWithdrawalOpen]=useState(false);
  const [withdrawal,setWithdrawal]=useState({effectiveDate:dateToday(),reason:''});
  const [application, setApplication] = useState({ fullName: '', dateOfBirth: '', classId: '', startDate: dateToday(), admissionNumber: '' });
  const [newYear, setNewYear] = useState({ name: '', startDate: '', endDate: '' });
  const [newClass, setNewClass] = useState({ name: '', level: 'Primary' as SchoolClass['level'], capacity: '', academicYearId: '' });
  const operations = useRef(new Map<string, { payload: string; id: string }>());
  const learnerEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const workspaceEpoch = useRef(0);
  const alive = useRef(true);

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
  }, [schoolId, admissionsOffset, admissionsSearch, learnersOffset, learnersSearch]);

  const loadMore = async (kind: 'academic-years' | 'classes') => {
    const loaded = kind === 'classes' ? classes.length : years.length;
    try {
      if (kind === 'classes') { const page = await request<Page<SchoolClass>>(`/schools/${schoolId}/classes?limit=100&offset=${loaded}`); if (alive.current) { setClasses(prior => [...prior, ...page.items]); setClassesTotal(page.total); } }
      else { const page = await request<Page<AcademicYear>>(`/schools/${schoolId}/academic-years?limit=100&offset=${loaded}`); if (alive.current) { setYears(prior => [...prior, ...page.items]); setYearsTotal(page.total); } }
    } catch (e) { if (alive.current) setError((e as Error).message); }
  };

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
    setDetail(null);
    setWithdrawalOpen(false);setWithdrawal({effectiveDate:dateToday(),reason:''});
    if (!selectedLearner) return;
    void request<LearnerDetail>(`/schools/${schoolId}/learners/${selectedLearner}`).then(row => {
      if (alive.current && learnerEpoch.current === epoch) setDetail(row);
    }).catch(e => { if (alive.current && learnerEpoch.current === epoch) setError((e as Error).message); });
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
    const payload = { fullName: application.fullName.trim(), ...(application.dateOfBirth ? { dateOfBirth: application.dateOfBirth } : {}), classId: application.classId, startDate: application.startDate, admissionNumber: application.admissionNumber.trim() };
    if (await send('application', payload, `/schools/${schoolId}/admissions`, 'Application recorded. Review and enrolment remain staff decisions.')) { setApplication({ fullName: '', dateOfBirth: '', classId: '', startDate: dateToday(), admissionNumber: '' }); setDialog(''); setTab('applications'); }
  }

  async function transition(row: Admission, action: string) {
    const reason = reviewReason[row.id]?.trim() ?? '';
    const override = overrideReasons[row.id]?.trim() ?? '';
    const payload = { version: row.version, action, ...(reason ? { reason } : {}), ...(action === 'enrol' && override ? { capacityOverrideReason: override } : {}) };
    if (await send(`transition:${row.id}:${action}`, payload, `/schools/${schoolId}/admissions/${row.id}/transition`, `${statusNames[action] ?? action} saved for ${row.full_name}.`)) {
      setReviewReason(prev => ({ ...prev, [row.id]: '' })); setOverrideReasons(prev => ({ ...prev, [row.id]: '' }));
    }
  }

  async function createYear(event: React.FormEvent) {
    event.preventDefault();
    const payload = { name: newYear.name.trim(), startDate: newYear.startDate, endDate: newYear.endDate };
    if (await send('academic-year', payload, `/schools/${schoolId}/academic-years`, 'Academic year added.')) setNewYear({ name: '', startDate: '', endDate: '' });
  }

  async function createClass(event: React.FormEvent) {
    event.preventDefault();
    const payload = { name: newClass.name.trim(), level: newClass.level, capacity: Number(newClass.capacity), academicYearId: newClass.academicYearId };
    if (await send('class', payload, `/schools/${schoolId}/classes`, 'Class added.')) setNewClass({ name: '', level: 'Primary', capacity: '', academicYearId: '' });
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
    if(await send(`withdraw:${detail.id}`,payload,`/schools/${schoolId}/learners/${detail.id}/withdraw`,'Withdrawal recorded. Learner and class history are retained.'))setWithdrawalOpen(false);
  }

  function actionsFor(row: Admission) {
    if (row.status === 'application') return ['review'];
    if (row.status === 'review') return ['offer', 'waitlist', 'decline'];
    if (row.status === 'offered') return ['accept'];
    if (row.status === 'waitlisted') return ['offer', 'decline'];
    if (row.status === 'accepted') return ['enrol'];
    return [];
  }

  const messages = <>{error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}</>;
  const classLabel = (c: SchoolClass) => `${c.name} · ${c.level} · ${c.year_name}`;
  const pager = (offset: number, shown: number, total: number, noun: string, move: (offset: number) => void) => <div className="pager" aria-label={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} pages`}>
    <span>{total === 0 ? `0 ${noun}` : `Showing ${offset + 1}–${Math.min(offset + shown, total)} of ${total} ${noun}`}</span>
    <div><button type="button" className="secondary" disabled={busy || offset === 0} onClick={() => move(Math.max(0, offset - 25))}>Previous {noun}</button><button type="button" className="secondary" disabled={busy || offset + shown >= total} onClick={() => move(offset + 25)}>Next {noun}</button></div>
  </div>;

  if (view === 'setup') return <section aria-labelledby="admissions-title" className="page">
    <h2 id="admissions-title" className="sr-only">Academic years and classes</h2>
    {messages}
    {loading ? <p role="status">Loading academic years and classes…</p> : <>
      <Card title="Academic years" hint="End dates are exclusive: the first day after the year ends." flush>
        {years.length ? <div className="table-wrap"><table><thead><tr><th>Year</th><th>Starts</th><th>Ends (exclusive)</th></tr></thead><tbody>{years.map(y => <tr key={y.id}><td>{y.name}</td><td>{y.start_date}</td><td>{y.end_date}</td></tr>)}</tbody></table></div> : <Empty title="No academic years recorded"/>}
        {years.length < yearsTotal && <p>Showing {years.length} of {yearsTotal} academic years. <button type="button" className="secondary" onClick={() => void loadMore('academic-years')}>Show more years</button></p>}
        <form onSubmit={createYear} className="card-body"><h4>Add academic year</h4><div className="grid"><label>Year name<input value={newYear.name} onChange={e => setNewYear({ ...newYear, name: e.target.value })} required maxLength={80} placeholder="2026/2027"/></label><label>Start date<input type="date" value={newYear.startDate} onChange={e => setNewYear({ ...newYear, startDate: e.target.value })} required/></label><label>End date (exclusive)<input type="date" value={newYear.endDate} onChange={e => setNewYear({ ...newYear, endDate: e.target.value })} required/></label></div><button disabled={busy}>Add academic year</button></form>
      </Card>
      <Card title="Classes" hint="Newest year first." flush>
        {classes.length ? <div className="table-wrap"><table><thead><tr><th>Class</th><th>Level</th><th>Year</th><th className="num">Capacity</th></tr></thead><tbody>{classes.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.level}</td><td>{c.year_name}</td><td className="num">{c.capacity}</td></tr>)}</tbody></table></div> : <Empty title="No classes recorded"/>}
        {classes.length < classesTotal && <p>Showing {classes.length} of {classesTotal} classes, newest year first. <button type="button" className="secondary" onClick={() => void loadMore('classes')}>Show more classes</button></p>}
        <form onSubmit={createClass} className="card-body"><h4>Add class</h4><div className="grid"><label>Class name<input value={newClass.name} onChange={e => setNewClass({ ...newClass, name: e.target.value })} required maxLength={80} placeholder="Primary 1 Blue"/></label><label>Level<select value={newClass.level} onChange={e => setNewClass({ ...newClass, level: e.target.value as SchoolClass['level'] })}>{levels.map(level => <option key={level}>{level}</option>)}</select></label><label>Capacity<input type="number" min="1" max="500" step="1" value={newClass.capacity} onChange={e => setNewClass({ ...newClass, capacity: e.target.value })} required/></label><label>Academic year<select value={newClass.academicYearId} onChange={e => setNewClass({ ...newClass, academicYearId: e.target.value })} required><option value="">Choose an academic year</option>{years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label></div><button disabled={busy || !years.length}>Add class</button></form>
      </Card>
    </>}
  </section>;

  return <section aria-label="Admissions and learners" className="page">
    <PageHeader eyebrow="People" title="Learners" blurb="Every learner record, application and class history in one place."
      actions={<><button type="button" disabled={loading || !classes.length} onClick={() => { setError(''); setNotice(''); setDialog('application'); }}><Icon name="person_add"/>New application</button><button type="button" className="secondary" onClick={() => setDialog('import')}><Icon name="upload_file"/>Import existing learners</button><button type="button" className="secondary" disabled={busy || loading} onClick={() => void loadWorkspace(true)}>Refresh records</button></>}/>
    {!dialog && !selectedLearner && messages}
    {loading ? <p role="status">Loading admissions and learner records…</p> : <>
      <div className="actions"><Tabs label="Learner lists" value={tab} onChange={setTab} options={[{ id: 'roll', label: `Learner roll (${learnersTotal})` }, { id: 'applications', label: `Admissions (${admissionsTotal})` }]}/></div>
      {tab === 'roll' ? <Card flush>
        <div className="toolbar">
          <form onSubmit={event => { event.preventDefault(); setLearnersOffset(0); setLearnersSearch(learnersSearchInput.trim()); }}>
            <label className="search"><span className="sr-only">Search learners</span><Icon name="search"/><input type="search" aria-label="Search learners" value={learnersSearchInput} onChange={event => setLearnersSearchInput(event.target.value)} placeholder="Search name or admission number"/></label>
            <button type="submit" className="secondary" disabled={busy}>Search</button>
          </form>
          <span className="count">{learnersTotal} learners</span>
        </div>
        {learners.length ? <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Admission no.</th><th className="hide-sm">Date of birth</th><th className="hide-sm"></th></tr></thead><tbody>{learners.map(row => <tr key={row.id}>
          <td><button type="button" className="link-button" onClick={() => setSelectedLearner(row.id)}>{row.full_name}</button></td><td>{row.admission_number}</td><td className="hide-sm">{row.date_of_birth ?? '—'}</td>
          <td className="num hide-sm"><button type="button" className="secondary" aria-label={`Open ${row.full_name}`} onClick={() => setSelectedLearner(row.id)}>Open</button></td></tr>)}</tbody></table></div>
          : <Empty title={learnersSearch ? 'No learners match this search' : 'No learners yet'} hint={learnersSearch ? undefined : 'Record an application or import your class lists from Excel.'}/>}
        {pager(learnersOffset, learners.length, learnersTotal, 'learners', setLearnersOffset)}
      </Card> : <Card flush>
        <div className="toolbar">
          <form onSubmit={event => { event.preventDefault(); setAdmissionsOffset(0); setAdmissionsSearch(admissionsSearchInput.trim()); }}>
            <label className="search"><span className="sr-only">Search applications</span><Icon name="search"/><input type="search" aria-label="Search applications" value={admissionsSearchInput} onChange={event => setAdmissionsSearchInput(event.target.value)} placeholder="Search name or admission number"/></label>
            <button type="submit" className="secondary" disabled={busy}>Search</button>
          </form>
          <span className="count">{admissionsTotal} applications</span>
        </div>
        {admissions.length ? <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Class</th><th>Starts</th><th>Status</th><th>Next step</th></tr></thead><tbody>{admissions.map(row => <tr key={row.id}>
          <td>{row.full_name}<span className="sub">{row.admission_number}{row.date_of_birth ? ` · Born ${row.date_of_birth}` : ''}</span>{row.decision_reason && <span className="sub">Decision note: {row.decision_reason}</span>}</td>
          <td>{row.class_name}</td><td>{row.start_date}</td><td><Pill tone={statusTone[row.status] ?? 'neutral'}>{statusNames[row.status] ?? row.status}</Pill></td>
          <td>{actionsFor(row).length ? <div className="actions">{actionsFor(row).map(action => <button type="button" key={action} className={action === 'decline' || action === 'waitlist' ? 'secondary' : undefined} disabled={busy} onClick={() => void transition(row, action)}>{actionNames[action]}</button>)}
            {actionsFor(row).some(action => action === 'waitlist' || action === 'decline') && <input aria-label="Decision reason" value={reviewReason[row.id] ?? ''} onChange={e => setReviewReason(prev => ({ ...prev, [row.id]: e.target.value }))} placeholder="Reason, for waitlist or decline"/>}
            {row.status === 'accepted' && role === 'headteacher' && <input aria-label="Capacity override reason (only if the class is full)" value={overrideReasons[row.id] ?? ''} onChange={e => setOverrideReasons(prev => ({ ...prev, [row.id]: e.target.value }))} placeholder="Capacity override reason, if full"/>}</div> : <span className="muted">—</span>}</td>
        </tr>)}</tbody></table></div> : <Empty title={admissionsSearch ? 'No applications match this search' : 'No applications yet'}/>}
        {pager(admissionsOffset, admissions.length, admissionsTotal, 'applications', setAdmissionsOffset)}
      </Card>}
    </>}

    {dialog === 'application' && <Dialog title="New application" onClose={() => setDialog('')}>
      {messages}
      <form onSubmit={submitApplication}>
        <label>Learner full name<input autoComplete="off" value={application.fullName} onChange={e => setApplication({ ...application, fullName: e.target.value })} required minLength={3} maxLength={120}/></label>
        <div className="grid"><label>Admission number<input value={application.admissionNumber} onChange={e => setApplication({ ...application, admissionNumber: e.target.value })} required minLength={2} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9/-]{1,39}"/></label>
        <label>Date of birth (optional)<input type="date" value={application.dateOfBirth} onChange={e => setApplication({ ...application, dateOfBirth: e.target.value })}/></label></div>
        <label>Intended class<select value={application.classId} onChange={e => setApplication({ ...application, classId: e.target.value })} required><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select></label>
        <label>Proposed start date<input type="date" value={application.startDate} onChange={e => setApplication({ ...application, startDate: e.target.value })} required/></label>
        <div className="actions"><button disabled={busy || !classes.length}>{busy ? 'Saving…' : 'Record application'}</button><button type="button" className="secondary" onClick={() => setDialog('')}>Cancel</button></div>
      </form>
    </Dialog>}
    {dialog === 'import' && <Dialog title="Import existing learners" wide onClose={() => setDialog('')}>
      <LearnerImports schoolId={schoolId} csrfToken={csrfToken} role={role} inDialog onCommitted={() => loadWorkspace(false, true)} />
    </Dialog>}

    {selectedLearner && <Dialog title={detail?.full_name ?? 'Learner'} drawer onClose={() => setSelectedLearner('')}>
      {messages}
      {!detail ? <p role="status">Loading learner history…</p> : <div>
        <p className="muted">Admission number {detail.admission_number}{detail.date_of_birth ? ` · Date of birth ${detail.date_of_birth}` : ''}</p>
        <h4>Class history</h4>{detail.enrolments.length ? <ul className="history">{detail.enrolments.map(row => <li key={row.id}><strong>{row.class_name}</strong><span>{row.start_date}{row.end_date ? ` to ${row.end_date} (end exclusive)` : ' · Open-ended'} · {row.superseded_at ? `Superseded · ${row.supersession_reason}` : row.start_date > dateToday() ? 'Scheduled' : row.end_date && row.end_date <= dateToday() ? 'Ended' : 'Active today'}{row.end_reason ? ` · ${row.end_reason}` : ''}</span></li>)}</ul> : <p>No enrolments recorded.</p>}
        {detail.enrolments.some(row=>!row.end_date&&!row.superseded_at) ? <><form onSubmit={transferLearner}><h4>Transfer to another class</h4>
          <label>New class<select value={transfer.classId} onChange={e => setTransfer({ ...transfer, classId: e.target.value })} required><option value="">Choose a class</option>{classes.filter(c => !detail.enrolments.some(enrolment => enrolment.class_id === c.id && !enrolment.end_date && !enrolment.superseded_at)).map(c => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}</select></label>
          <div className="grid"><label>Effective date<input type="date" value={transfer.effectiveDate} onChange={e => setTransfer({ ...transfer, effectiveDate: e.target.value })} required/></label>
          <label>Transfer reason<input value={transfer.reason} onChange={e => setTransfer({ ...transfer, reason: e.target.value })} required maxLength={500}/></label></div>
          <button disabled={busy || !transfer.classId}>Record transfer</button>
        </form>
        <h4>Leaving the school</h4>
        <button type="button" className="secondary" aria-expanded={withdrawalOpen} disabled={busy} onClick={()=>setWithdrawalOpen(!withdrawalOpen)}>Withdraw learner</button>
        {withdrawalOpen&&<form onSubmit={withdrawLearner}><h4>Record withdrawal</h4><p className="muted">The learner leaves this class on the selected date. Previous records remain available. Scheduled transfers on or after this date are superseded, with their original history retained.</p>
          <label>Withdrawal date (first day out of class)<input type="date" value={withdrawal.effectiveDate} onChange={e=>setWithdrawal({...withdrawal,effectiveDate:e.target.value})} required/></label>
          <label>Withdrawal reason<input value={withdrawal.reason} onChange={e=>setWithdrawal({...withdrawal,reason:e.target.value})} required minLength={3} maxLength={500}/></label>
          <button disabled={busy}>Record withdrawal</button>
        </form>}</> : <p>No open enrolment. Previous learner and class records are retained.</p>}
      </div>}
    </Dialog>}
  </section>;
}
