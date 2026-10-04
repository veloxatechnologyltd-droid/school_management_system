import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { LearnerImports } from './LearnerImports';

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
  const [setupOpen,setSetupOpen]=useState(view==='setup');
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
    if (await send('application', payload, `/schools/${schoolId}/admissions`, 'Application recorded. Review and enrolment remain staff decisions.')) setApplication({ fullName: '', dateOfBirth: '', classId: '', startDate: dateToday(), admissionNumber: '' });
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

  return <section aria-labelledby="admissions-title">
    <h2 id="admissions-title">{view === 'setup' ? 'Academic years and classes' : 'Admissions and learners'}</h2>
    <div className="actions"><button type="button" className="secondary" disabled={busy || loading} onClick={() => void loadWorkspace(true)}>Refresh records</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    {loading ? <p role="status">Loading admissions and learner records…</p> : <>
      {view !== 'setup' && <><h3>Applications</h3>
      <form className="actions" onSubmit={event => { event.preventDefault(); setAdmissionsOffset(0); setAdmissionsSearch(admissionsSearchInput.trim()); }}>
        <label>Search applications<input type="search" value={admissionsSearchInput} onChange={event => setAdmissionsSearchInput(event.target.value)} placeholder="Learner name or admission number"/></label>
        <button type="submit" disabled={busy}>Search</button>
      </form>
      {admissions.length ? <ul className="history">{admissions.map(row => <li key={row.id}>
        <strong>{row.full_name} <span className="muted">· {statusNames[row.status] ?? row.status}</span></strong>
        <span>{row.admission_number} · {row.class_name} · Starts {row.start_date}{row.date_of_birth ? ` · Born ${row.date_of_birth}` : ''}</span>
        {row.decision_reason && <span>Decision note: {row.decision_reason}</span>}
        <div className="actions">{actionsFor(row).map(action => <button type="button" key={action} disabled={busy} onClick={() => void transition(row, action)}>{action === 'review' ? 'Start review' : action === 'offer' ? 'Offer place' : action === 'waitlist' ? 'Waitlist' : action === 'decline' ? 'Decline' : action === 'accept' ? 'Record acceptance' : 'Enrol learner'}</button>)}</div>
        {actionsFor(row).some(action => action === 'waitlist' || action === 'decline') && <label>Decision reason<input value={reviewReason[row.id] ?? ''} onChange={e => setReviewReason(prev => ({ ...prev, [row.id]: e.target.value }))} placeholder="Required for waitlist or decline"/></label>}
        {row.status === 'accepted' && role === 'headteacher' && <label>Capacity override reason (only if the class is full)<input value={overrideReasons[row.id] ?? ''} onChange={e => setOverrideReasons(prev => ({ ...prev, [row.id]: e.target.value }))}/></label>}
      </li>)}</ul> : <p>{admissionsSearch ? 'No applications match this search.' : 'No applications yet.'}</p>}
      <div className="actions" aria-label="Application pages"><button type="button" className="secondary" disabled={busy || admissionsOffset === 0} onClick={() => setAdmissionsOffset(Math.max(0, admissionsOffset - 25))}>Previous applications</button><span className="muted">{admissionsTotal === 0 ? '0 applications' : `Showing ${admissionsOffset + 1}–${Math.min(admissionsOffset + admissions.length, admissionsTotal)} of ${admissionsTotal} applications`}</span><button type="button" className="secondary" disabled={busy || admissionsOffset + admissions.length >= admissionsTotal} onClick={() => setAdmissionsOffset(admissionsOffset + 25)}>Next applications</button></div>

      <h3>Record an application</h3>
      <form onSubmit={submitApplication}>
        <label>Learner full name<input autoComplete="off" value={application.fullName} onChange={e => setApplication({ ...application, fullName: e.target.value })} required minLength={3} maxLength={120}/></label>
        <label>Date of birth (optional)<input type="date" value={application.dateOfBirth} onChange={e => setApplication({ ...application, dateOfBirth: e.target.value })}/></label>
        <label>Admission number<input value={application.admissionNumber} onChange={e => setApplication({ ...application, admissionNumber: e.target.value })} required minLength={2} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9/-]{1,39}"/></label>
        <label>Intended class<select value={application.classId} onChange={e => setApplication({ ...application, classId: e.target.value })} required><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.level} · {c.year_name}</option>)}</select></label>
        <label>Proposed start date<input type="date" value={application.startDate} onChange={e => setApplication({ ...application, startDate: e.target.value })} required/></label>
        <button disabled={busy || !classes.length}>{busy ? 'Saving…' : 'Record application'}</button>
      </form>
      <LearnerImports schoolId={schoolId} csrfToken={csrfToken} role={role} onCommitted={() => loadWorkspace(false, true)} />

      <h3>Learner records</h3>
      <form className="actions" onSubmit={event => { event.preventDefault(); setLearnersOffset(0); setLearnersSearch(learnersSearchInput.trim()); }}>
        <label>Search learners<input type="search" value={learnersSearchInput} onChange={event => setLearnersSearchInput(event.target.value)} placeholder="Learner name or admission number"/></label>
        <button type="submit" disabled={busy}>Search</button>
      </form>
      <label>Find a learner<select value={selectedLearner} onChange={e => setSelectedLearner(e.target.value)}><option value="">Select a learner on this page</option>{selectedLearner && !learners.some(row => row.id === selectedLearner) && <option value={selectedLearner}>{detail ? `${detail.full_name} · ${detail.admission_number} (selected)` : 'Selected learner'}</option>}{learners.map(row => <option key={row.id} value={row.id}>{row.full_name} · {row.admission_number}</option>)}</select></label>
      <div className="actions" aria-label="Learner pages"><button type="button" className="secondary" disabled={busy || learnersOffset === 0} onClick={() => setLearnersOffset(Math.max(0, learnersOffset - 25))}>Previous learners</button><span className="muted">{learnersTotal === 0 ? '0 learners' : `Showing ${learnersOffset + 1}–${Math.min(learnersOffset + learners.length, learnersTotal)} of ${learnersTotal} learners`}</span><button type="button" className="secondary" disabled={busy || learnersOffset + learners.length >= learnersTotal} onClick={() => setLearnersOffset(learnersOffset + 25)}>Next learners</button></div>
      {selectedLearner && !detail ? <p role="status">Loading learner history…</p> : detail && <div>
        <h4>{detail.full_name}</h4><p className="muted">Admission number {detail.admission_number}{detail.date_of_birth ? ` · Date of birth ${detail.date_of_birth}` : ''}</p>
        <h4>Class history</h4>{detail.enrolments.length ? <ul className="history">{detail.enrolments.map(row => <li key={row.id}><strong>{row.class_name}</strong><span>{row.start_date}{row.end_date ? ` to ${row.end_date} (end exclusive)` : ' · Open-ended'} · {row.superseded_at ? `Superseded · ${row.supersession_reason}` : row.start_date > dateToday() ? 'Scheduled' : row.end_date && row.end_date <= dateToday() ? 'Ended' : 'Active today'}{row.end_reason ? ` · ${row.end_reason}` : ''}</span></li>)}</ul> : <p>No enrolments recorded.</p>}
        {detail.enrolments.some(row=>!row.end_date&&!row.superseded_at) ? <><form onSubmit={transferLearner}><h4>Transfer to another class</h4>
          <label>New class<select value={transfer.classId} onChange={e => setTransfer({ ...transfer, classId: e.target.value })} required><option value="">Choose a class</option>{classes.filter(c => !detail.enrolments.some(enrolment => enrolment.class_id === c.id && !enrolment.end_date && !enrolment.superseded_at)).map(c => <option key={c.id} value={c.id}>{c.name} · {c.level} · {c.year_name}</option>)}</select></label>
          <label>Effective date<input type="date" value={transfer.effectiveDate} onChange={e => setTransfer({ ...transfer, effectiveDate: e.target.value })} required/></label>
          <label>Transfer reason<input value={transfer.reason} onChange={e => setTransfer({ ...transfer, reason: e.target.value })} required maxLength={500}/></label>
          <button disabled={busy || !transfer.classId}>Record transfer</button>
        </form>
        <button type="button" className="secondary" aria-expanded={withdrawalOpen} disabled={busy} onClick={()=>setWithdrawalOpen(!withdrawalOpen)}>Withdraw learner</button>
        {withdrawalOpen&&<form onSubmit={withdrawLearner}><h4>Record withdrawal</h4><p className="muted">The learner leaves this class on the selected date. Previous records remain available. Scheduled transfers on or after this date are superseded, with their original history retained.</p>
          <label>Withdrawal date (first day out of class)<input type="date" value={withdrawal.effectiveDate} onChange={e=>setWithdrawal({...withdrawal,effectiveDate:e.target.value})} required/></label>
          <label>Withdrawal reason<input value={withdrawal.reason} onChange={e=>setWithdrawal({...withdrawal,reason:e.target.value})} required minLength={3} maxLength={500}/></label>
          <button disabled={busy}>Record withdrawal</button>
        </form>}</> : <p>No open enrolment. Previous learner and class records are retained.</p>}
      </div>}

      </>}{role === 'headteacher' && view !== 'work' && <div>{view !== 'setup' && <button type="button" className="secondary" aria-expanded={setupOpen} onClick={()=>setSetupOpen(!setupOpen)}>School setup: academic years and classes</button>}{setupOpen&&<div>
        <h3>Academic years</h3>{years.length ? <ul className="history">{years.map(y => <li key={y.id}><strong>{y.name}</strong><span>{y.start_date} to {y.end_date} (end date exclusive)</span></li>)}</ul> : <p>No academic years recorded.</p>}{years.length < yearsTotal && <p>Showing {years.length} of {yearsTotal} academic years. <button type="button" className="secondary" onClick={() => void loadMore('academic-years')}>Show more years</button></p>}
        <form onSubmit={createYear}><h4>Add academic year</h4><label>Year name<input value={newYear.name} onChange={e => setNewYear({ ...newYear, name: e.target.value })} required maxLength={80} placeholder="2026/2027"/></label><label>Start date<input type="date" value={newYear.startDate} onChange={e => setNewYear({ ...newYear, startDate: e.target.value })} required/></label><label>End date (exclusive)<input type="date" value={newYear.endDate} onChange={e => setNewYear({ ...newYear, endDate: e.target.value })} required/></label><button disabled={busy}>Add academic year</button></form>
        <h3>Classes</h3>{classes.length ? <ul className="history">{classes.map(c => <li key={c.id}><strong>{c.name} · {c.level}</strong><span>{c.year_name} · Capacity {c.capacity} · {c.start_date} to {c.end_date}</span></li>)}</ul> : <p>No classes recorded.</p>}{classes.length < classesTotal && <p>Showing {classes.length} of {classesTotal} classes, newest year first. <button type="button" className="secondary" onClick={() => void loadMore('classes')}>Show more classes</button></p>}
        <form onSubmit={createClass}><h4>Add class</h4><label>Class name<input value={newClass.name} onChange={e => setNewClass({ ...newClass, name: e.target.value })} required maxLength={80} placeholder="Primary 1 Blue"/></label><label>Level<select value={newClass.level} onChange={e => setNewClass({ ...newClass, level: e.target.value as SchoolClass['level'] })}>{levels.map(level => <option key={level}>{level}</option>)}</select></label><label>Capacity<input type="number" min="1" max="500" step="1" value={newClass.capacity} onChange={e => setNewClass({ ...newClass, capacity: e.target.value })} required/></label><label>Academic year<select value={newClass.academicYearId} onChange={e => setNewClass({ ...newClass, academicYearId: e.target.value })} required><option value="">Choose an academic year</option>{years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label><button disabled={busy || !years.length}>Add class</button></form>
      </div>}</div>}
    </>}
  </section>;
}
