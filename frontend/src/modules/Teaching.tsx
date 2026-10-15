import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Empty, Icon } from '../lib/ui';

type Role = 'headteacher' | 'teacher' | string;
type Props = { schoolId: string; csrfToken: string; role: Role; onAccessRefresh?: () => void };
type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type TeacherCandidate = { id: string; display_name: string };
type ClassOption = { id: string; name: string; level: string; year_name: string; start_date: string; end_date: string };
type Assignment = { id: string; class_id: string; class_name: string; teacher_display_name: string; start_date: string; end_date: string; grant_reason: string; revoked_at?: string | null; revocation_reason?: string | null; version: number };
type TeacherClass = { id: string; name: string; level: string; year_name: string };
type RosterLearner = { id: string; full_name: string; admission_number: string; enrolment_id: string };
type SelectedClass = Pick<TeacherClass, 'id' | 'name' | 'level' | 'year_name'>;

const todayInGhana = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });

export function Teaching({ schoolId, csrfToken, role, onAccessRefresh }: Props) {
  const isHeadteacher = role === 'headteacher';
  const [candidates, setCandidates] = useState<TeacherCandidate[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [classTotal, setClassTotal] = useState(0);
  const [classOffset, setClassOffset] = useState(0);
  const [classSearchInput, setClassSearchInput] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedClassOption, setSelectedClassOption] = useState<SelectedClass | null>(null);
  const [teacherMembershipId, setTeacherMembershipId] = useState('');
  const [assignmentDates, setAssignmentDates] = useState({ startDate: '', endDate: '', reason: '' });
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentTotal, setAssignmentTotal] = useState(0);
  const [assignmentOffset, setAssignmentOffset] = useState(0);
  const [assignmentSearchInput, setAssignmentSearchInput] = useState('');
  const [assignmentSearch, setAssignmentSearch] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [teacherDateInput, setTeacherDateInput] = useState(todayInGhana());
  const [teacherDate, setTeacherDate] = useState(todayInGhana());
  const [teacherClassRows, setTeacherClassRows] = useState<TeacherClass[]>([]);
  const [teacherClassTotal, setTeacherClassTotal] = useState(0);
  const [teacherClassOffset, setTeacherClassOffset] = useState(0);
  const [teacherClassSearchInput, setTeacherClassSearchInput] = useState('');
  const [teacherClassSearch, setTeacherClassSearch] = useState('');
  const [teacherRefresh, setTeacherRefresh] = useState(0);
  const [roster, setRoster] = useState<RosterLearner[]>([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [rosterClassName, setRosterClassName] = useState('');
  const [rosterDate, setRosterDate] = useState('');
  const [rosterOffset, setRosterOffset] = useState(0);
  const [rosterSearchInput, setRosterSearchInput] = useState('');
  const [rosterSearch, setRosterSearch] = useState('');
  const [headLoading, setHeadLoading] = useState(true);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [teacherClassLoading, setTeacherClassLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operations = useRef(new Map<string, { payload: string; id: string }>());
  const alive = useRef(true);
  const headEpoch = useRef(0);
  const assignmentEpoch = useRef(0);
  const teacherClassEpoch = useRef(0);
  const rosterEpoch = useRef(0);
  const selectedClassRef = useRef('');

  const operationId = (key: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    const previous = operations.current.get(key);
    if (previous?.payload === serialized) return previous.id;
    const next = { payload: serialized, id: crypto.randomUUID() };
    operations.current.set(key, next);
    return next.id;
  };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; headEpoch.current++; assignmentEpoch.current++; teacherClassEpoch.current++; rosterEpoch.current++; };
  }, []);

  useEffect(() => {
    if (!isHeadteacher) return;
    const epoch = ++headEpoch.current;
    setHeadLoading(true); setError('');
    const query = new URLSearchParams({ offset: String(classOffset), limit: '25' });
    if (classSearch.trim()) query.set('search', classSearch.trim());
    void Promise.all([
      request<TeacherCandidate[]>(`/schools/${schoolId}/teacher-candidates`),
      request<Page<ClassOption>>(`/schools/${schoolId}/teaching/class-options?${query.toString()}`),
    ]).then(([candidateRows, classPage]) => {
      if (!alive.current || headEpoch.current !== epoch) return;
      setCandidates(candidateRows); setClassOptions(classPage.items); setClassTotal(classPage.total);
    }).catch(e => { if (alive.current && headEpoch.current === epoch) setError((e as Error).message); })
      .finally(() => { if (alive.current && headEpoch.current === epoch) setHeadLoading(false); });
  }, [classOffset, classSearch, isHeadteacher, schoolId]);

  useEffect(() => {
    if (!isHeadteacher) return;
    const epoch = ++assignmentEpoch.current;
    setAssignmentLoading(true); setError('');
    const query = new URLSearchParams({ offset: String(assignmentOffset), limit: '25' });
    if (assignmentSearch.trim()) query.set('search', assignmentSearch.trim());
    void request<Page<Assignment>>(`/schools/${schoolId}/teaching/assignments?${query.toString()}`).then(page => {
      if (!alive.current || assignmentEpoch.current !== epoch) return;
      setAssignments(page.items); setAssignmentTotal(page.total);
    }).catch(e => { if (alive.current && assignmentEpoch.current === epoch) setError((e as Error).message); })
      .finally(() => { if (alive.current && assignmentEpoch.current === epoch) setAssignmentLoading(false); });
  }, [assignmentOffset, assignmentSearch, isHeadteacher, schoolId]);

  useEffect(() => {
    if (isHeadteacher) return;
    const epoch = ++teacherClassEpoch.current;
    setTeacherClassLoading(true); setError('');
    const query = new URLSearchParams({ date: teacherDate, offset: String(teacherClassOffset), limit: '25' });
    if (teacherClassSearch.trim()) query.set('search', teacherClassSearch.trim());
    void request<Page<TeacherClass>>(`/schools/${schoolId}/teaching/classes?${query.toString()}`).then(page => {
      if (!alive.current || teacherClassEpoch.current !== epoch) return;
      setTeacherClassRows(page.items); setTeacherClassTotal(page.total);
      // Open on the first assigned class rather than an empty choice.
      if (!selectedClassRef.current && page.items[0]) { const first = page.items[0]; selectedClassRef.current = first.id; setSelectedClass(first.id); setSelectedClassOption(first); setRosterOffset(0); }
    }).catch(e => { if (alive.current && teacherClassEpoch.current === epoch) { setTeacherClassRows([]); setTeacherClassTotal(0); setSelectedClass(''); selectedClassRef.current = ''; setSelectedClassOption(null); rosterEpoch.current++; setRoster([]); setRosterTotal(0); setRosterClassName(''); setRosterDate(''); setRosterLoading(false); setError((e as Error).message); } })
      .finally(() => { if (alive.current && teacherClassEpoch.current === epoch) setTeacherClassLoading(false); });
  }, [isHeadteacher, schoolId, teacherDate, teacherClassOffset, teacherClassSearch, teacherRefresh]);

  useEffect(() => {
    const epoch = ++rosterEpoch.current;
    setRoster([]); setRosterTotal(0); setRosterClassName(''); setRosterDate('');
    if (isHeadteacher || !selectedClass) { setRosterLoading(false); return; }
    setRosterLoading(true); setError('');
    const requestedClass = selectedClass;
    const query = new URLSearchParams({ date: teacherDate, offset: String(rosterOffset), limit: '25' });
    if (rosterSearch.trim()) query.set('search', rosterSearch.trim());
    void request<Page<RosterLearner> & { className: string; date: string }>(`/schools/${schoolId}/teaching/classes/${requestedClass}/roster?${query.toString()}`).then(page => {
      if (!alive.current || rosterEpoch.current !== epoch || selectedClassRef.current !== requestedClass) return;
      setRoster(page.items); setRosterTotal(page.total); setRosterClassName(page.className); setRosterDate(page.date);
    }).catch(e => {
      if (alive.current && rosterEpoch.current === epoch && selectedClassRef.current === requestedClass) {
        setRoster([]); setRosterTotal(0); setRosterClassName(''); setRosterDate(''); setSelectedClass(''); selectedClassRef.current = ''; setSelectedClassOption(null);
        setError(`Class access could not be refreshed: ${(e as Error).message}`);
      }
    }).finally(() => { if (alive.current && rosterEpoch.current === epoch) setRosterLoading(false); });
  }, [isHeadteacher, rosterOffset, rosterSearch, schoolId, selectedClass, teacherDate]);

  async function refresh() {
    setError(''); setNotice('');
    if (isHeadteacher) {
      setClassOffset(0); setAssignmentOffset(0);
      setClassSearch(''); setClassSearchInput(''); setAssignmentSearch(''); setAssignmentSearchInput('');
      const head = ++headEpoch.current; const assignment = ++assignmentEpoch.current;
      setHeadLoading(true); setAssignmentLoading(true);
      const classQuery = new URLSearchParams({ offset: '0', limit: '25' });
      const assignmentQuery = new URLSearchParams({ offset: '0', limit: '25' });
      const results = await Promise.allSettled([
        request<TeacherCandidate[]>(`/schools/${schoolId}/teacher-candidates`),
        request<Page<ClassOption>>(`/schools/${schoolId}/teaching/class-options?${classQuery}`),
        request<Page<Assignment>>(`/schools/${schoolId}/teaching/assignments?${assignmentQuery}`),
      ]);
      if (!alive.current) return;
      if (headEpoch.current === head && results[0].status === 'fulfilled' && results[1].status === 'fulfilled') { setCandidates(results[0].value); setClassOptions(results[1].value.items); setClassTotal(results[1].value.total); }
      else if (headEpoch.current === head) setError(results.find(result => result.status === 'rejected')?.reason?.message ?? 'Could not refresh teaching setup.');
      if (assignmentEpoch.current === assignment && results[2].status === 'fulfilled') { setAssignments(results[2].value.items); setAssignmentTotal(results[2].value.total); }
      else if (assignmentEpoch.current === assignment && results[2].status === 'rejected') setError((results[2].reason as Error).message);
      if (headEpoch.current === head) setHeadLoading(false);
      if (assignmentEpoch.current === assignment) setAssignmentLoading(false);
    } else {
      onAccessRefresh?.();
      setSelectedClass(''); selectedClassRef.current = ''; setSelectedClassOption(null); setRoster([]); setRosterTotal(0); setRosterClassName(''); setRosterDate(''); setRosterOffset(0); setRosterSearch(''); setRosterSearchInput('');
      setTeacherRefresh(value => value + 1);
    }
  }

  async function mutate(key: string, payload: Record<string, unknown>, path: string, text: string) {
    setBusy(true); setError(''); setNotice('');
    const body = { ...payload, operationId: operationId(key, payload) };
    try {
      await request(path, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) });
      if (!alive.current) return false;
      operations.current.delete(key); setNotice(text);
      setAssignmentOffset(0); setClassOffset(0);
      setClassSearch(''); setClassSearchInput(''); setAssignmentSearch(''); setAssignmentSearchInput('');
      const classQuery = new URLSearchParams({ offset: '0', limit: '25' });
      const assignmentQuery = new URLSearchParams({ offset: '0', limit: '25' });
      const results = await Promise.all([
        request<TeacherCandidate[]>(`/schools/${schoolId}/teacher-candidates`),
        request<Page<ClassOption>>(`/schools/${schoolId}/teaching/class-options?${classQuery}`),
        request<Page<Assignment>>(`/schools/${schoolId}/teaching/assignments?${assignmentQuery}`),
      ]);
      if (alive.current) { setCandidates(results[0]); setClassOptions(results[1].items); setClassTotal(results[1].total); setAssignments(results[2].items); setAssignmentTotal(results[2].total); }
      return true;
    } catch (e) { if (alive.current) setError((e as Error).message); return false; }
    finally { if (alive.current) setBusy(false); }
  }

  async function createAssignment(event: React.FormEvent) {
    event.preventDefault();
    const payload = { classId: selectedClass, teacherMembershipId, startDate: assignmentDates.startDate, endDate: assignmentDates.endDate, reason: assignmentDates.reason.trim() };
    if (!selectedClass || !teacherMembershipId || !payload.startDate || !payload.endDate || !payload.reason) return;
    if (await mutate('teaching-assignment:create', payload, `/schools/${schoolId}/teaching/assignments`, 'Teaching assignment created. Its reason authorizes whole-class roster access.')) {
      setAssignmentDates({ startDate: '', endDate: '', reason: '' }); setTeacherMembershipId(''); setSelectedClass(''); setSelectedClassOption(null);
    }
  }

  async function revokeAssignment(row: Assignment) {
    const reason = revokeReasons[row.id]?.trim() ?? '';
    const payload = { version: row.version, reason };
    if (await mutate(`teaching-assignment:${row.id}:revoke`, payload, `/schools/${schoolId}/teaching/assignments/${row.id}/revoke`, `Assignment revoked for ${row.teacher_display_name}.`)) {
      setRevokeReasons(previous => ({ ...previous, [row.id]: '' }));
    }
  }

  const headLoadingNow = headLoading || assignmentLoading;

  if (!isHeadteacher) return <section aria-labelledby="teaching-title" className="card my-classes">
    <div className="card-head"><div><h2 id="teaching-title">My classes</h2><p className="card-hint">Learners in the classes your headteacher assigned to you.</p></div><button type="button" className="secondary" disabled={busy || teacherClassLoading} onClick={() => void refresh()}><Icon name="refresh"/>Refresh class access</button></div>
    {(error || notice) && <div className="card-body">{error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}</div>}
<>
      <div className="toolbar teacher-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSelectedClass(''); selectedClassRef.current = ''; setSelectedClassOption(null); setRoster([]); setRosterTotal(0); setRosterOffset(0); setRosterSearch(''); setRosterSearchInput(''); setTeacherClassOffset(0); setTeacherDate(teacherDateInput); setTeacherRefresh(value => value + 1); }}>
          <label>Class date<input type="date" value={teacherDateInput} onChange={event => setTeacherDateInput(event.target.value)} required/></label>
          <button type="submit" className="secondary" disabled={rosterLoading || teacherClassLoading}>Show classes for date</button>
        </form>
        {(teacherClassRows.length > 0 || selectedClass) && <label>Select an assigned class<select value={selectedClass} onChange={event => { const id = event.target.value; selectedClassRef.current = id; setSelectedClass(id); setSelectedClassOption(teacherClassRows.find(row => row.id === id) ?? null); setRosterOffset(0); setRosterSearch(''); setRosterSearchInput(''); }}><option value="">Choose a class</option>{selectedClassOption && !teacherClassRows.some(row => row.id === selectedClass) && <option value={selectedClassOption.id}>{selectedClassOption.name} · {selectedClassOption.level} · {selectedClassOption.year_name} (selected)</option>}{teacherClassRows.map(row => <option key={row.id} value={row.id}>{row.name} · {row.level} · {row.year_name}</option>)}</select></label>}
      </div>
      <div className="toolbar">
        <form onSubmit={event => { event.preventDefault(); setTeacherClassOffset(0); setTeacherClassSearch(teacherClassSearchInput.trim()); }}><label className="search"><span className="sr-only">Search my classes</span><Icon name="search"/><input type="search" aria-label="Search my classes" maxLength={120} value={teacherClassSearchInput} onChange={event => setTeacherClassSearchInput(event.target.value)} placeholder="Search my classes"/></label><button type="submit" className="secondary" disabled={teacherClassLoading}>Search classes</button></form>
        {teacherClassTotal > 25 && <div className="actions" aria-label="Assigned class pages"><button type="button" className="secondary" disabled={teacherClassOffset === 0} onClick={() => setTeacherClassOffset(Math.max(0, teacherClassOffset - 25))}>Previous classes</button><span className="muted">{`Showing ${teacherClassOffset + 1}–${Math.min(teacherClassOffset + teacherClassRows.length, teacherClassTotal)} of ${teacherClassTotal}`}</span><button type="button" className="secondary" disabled={teacherClassOffset + teacherClassRows.length >= teacherClassTotal} onClick={() => setTeacherClassOffset(teacherClassOffset + 25)}>Next classes</button></div>}
      </div>
      {teacherClassLoading && !selectedClass ? <p role="status">Loading assigned classes…</p> : !teacherClassRows.length && !selectedClass ? <Empty title={teacherClassSearch ? 'No assigned classes match this search' : 'No classes assigned for this date'} hint={teacherClassSearch ? undefined : 'Your headteacher assigns classes. Ask them if one is missing.'}/> : null}
      {selectedClass && <div className="class-roster">
        <div className="roster-head"><div><h3>{rosterClassName || selectedClassOption?.name || 'Class roster'}</h3><p className="card-hint">{rosterDate ? `Roster on ${rosterDate} · ` : ''}{rosterTotal} learner{rosterTotal === 1 ? '' : 's'}</p></div>
          <form onSubmit={event => { event.preventDefault(); setRosterOffset(0); setRosterSearch(rosterSearchInput.trim()); }}><label className="search"><span className="sr-only">Search this roster</span><Icon name="search"/><input type="search" aria-label="Search this roster" maxLength={120} value={rosterSearchInput} onChange={event => setRosterSearchInput(event.target.value)} placeholder="Learner name or admission number"/></label><button type="submit" className="secondary" disabled={rosterLoading}>Search roster</button></form></div>
        {rosterLoading ? <p role="status">Checking assignment and loading the current roster…</p> : roster.length ? <ul className="roster-grid">{roster.map(row => <li key={row.enrolment_id}><span className="avatar" aria-hidden="true">{row.full_name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span><span><strong>{row.full_name}</strong><span className="sub">{row.admission_number}</span></span></li>)}</ul> : <Empty title="No learners match this roster search"/>}
        {rosterTotal > 25 && <div className="pager" aria-label="Roster pages"><span>{`Showing ${rosterOffset + 1}–${Math.min(rosterOffset + roster.length, rosterTotal)} of ${rosterTotal}`}</span><div><button type="button" className="secondary" disabled={rosterLoading || rosterOffset === 0} onClick={() => setRosterOffset(Math.max(0, rosterOffset - 25))}>Previous learners</button><button type="button" className="secondary" disabled={rosterLoading || rosterOffset + roster.length >= rosterTotal} onClick={() => setRosterOffset(rosterOffset + 25)}>Next learners</button></div></div>}
      </div>}
    </>
  </section>;

  return <section aria-labelledby="teaching-title">
    <p className="eyebrow">Teaching access</p>
    <h2 id="teaching-title">{isHeadteacher ? 'Teacher assignments' : 'My classes'}</h2>
    <p className="muted">{isHeadteacher ? 'Grant dated whole-class roster access with a clear reason and revoke it with a reviewed reason.' : 'Open a class roster for a selected date. Access is rechecked by the school service.'}</p>
    <div className="actions"><button type="button" className="secondary" disabled={busy || (isHeadteacher ? headLoadingNow : teacherClassLoading)} onClick={() => void refresh()}>{isHeadteacher ? 'Refresh assignments' : 'Refresh class access'}</button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    {isHeadteacher ? headLoadingNow ? <p role="status">Loading teacher assignment records…</p> : <>
      <h3>Assignment history</h3>
      <form className="actions" onSubmit={event => { event.preventDefault(); setAssignmentOffset(0); setAssignmentSearch(assignmentSearchInput.trim()); }}><label>Search assignments<input type="search" maxLength={120} value={assignmentSearchInput} onChange={event => setAssignmentSearchInput(event.target.value)} placeholder="Class or teacher name"/></label><button type="submit" disabled={busy}>Search assignments</button></form>
      {assignments.length ? <ul className="history">{assignments.map(row => <li key={row.id}>
        <strong>{row.class_name} · {row.teacher_display_name}</strong>
        <span>{row.revoked_at ? `Revoked ${row.revoked_at}` : 'Not revoked'} · {row.start_date} to {row.end_date} (end exclusive)</span>
        <span>Grant reason: {row.grant_reason}</span>{row.revocation_reason && <span>Revocation reason: {row.revocation_reason}</span>}
        {!row.revoked_at && <form onSubmit={event => { event.preventDefault(); void revokeAssignment(row); }}><label>Revocation reason<input required minLength={3} maxLength={500} value={revokeReasons[row.id] ?? ''} onChange={event => setRevokeReasons(previous => ({ ...previous, [row.id]: event.target.value }))}/></label><button className="secondary" disabled={busy}>Revoke assignment</button></form>}
      </li>)}</ul> : <p>{assignmentSearch ? 'No assignments match this search.' : 'No teaching assignments recorded.'}</p>}
      <div className="actions" aria-label="Assignment history pages"><button type="button" className="secondary" disabled={busy || assignmentLoading || assignmentOffset === 0} onClick={() => setAssignmentOffset(Math.max(0, assignmentOffset - 25))}>Previous assignments</button><span className="muted">{assignmentTotal === 0 ? '0 assignments' : `Showing ${assignmentOffset + 1}–${Math.min(assignmentOffset + assignments.length, assignmentTotal)} of ${assignmentTotal}`}</span><button type="button" className="secondary" disabled={busy || assignmentLoading || assignmentOffset + assignments.length >= assignmentTotal} onClick={() => setAssignmentOffset(assignmentOffset + 25)}>Next assignments</button></div>

      <h3>Assign a teacher</h3>
      <form onSubmit={createAssignment}>
        <label>Search classes<input type="search" maxLength={120} value={classSearchInput} onChange={event => setClassSearchInput(event.target.value)} placeholder="Class name or level"/></label>
        <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setClassOffset(0); setClassSearch(classSearchInput.trim()); }}>Search classes</button><span className="muted">{classTotal === 0 ? '0 classes' : `Showing ${classOffset + 1}–${Math.min(classOffset + classOptions.length, classTotal)} of ${classTotal}`}</span><button type="button" className="secondary" disabled={busy || classOffset === 0} onClick={() => setClassOffset(Math.max(0, classOffset - 25))}>Previous classes</button><button type="button" className="secondary" disabled={busy || classOffset + classOptions.length >= classTotal} onClick={() => setClassOffset(classOffset + 25)}>Next classes</button></div>
        <label>Class<select value={selectedClass} onChange={event => { const id = event.target.value; setSelectedClass(id); setSelectedClassOption(classOptions.find(row => row.id === id) ?? null); }} required><option value="">Choose a class</option>{selectedClassOption && !classOptions.some(row => row.id === selectedClass) && <option value={selectedClassOption.id}>{selectedClassOption.name} · {selectedClassOption.level} · {selectedClassOption.year_name} (selected)</option>}{classOptions.map(row => <option key={row.id} value={row.id}>{row.name} · {row.level} · {row.year_name}</option>)}</select></label>
        <label>Teacher<select value={teacherMembershipId} onChange={event => setTeacherMembershipId(event.target.value)} required><option value="">Choose a teacher account</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.display_name}</option>)}</select></label>
        <label>Assignment start date (inclusive)<input type="date" value={assignmentDates.startDate} onChange={event => setAssignmentDates({ ...assignmentDates, startDate: event.target.value })} required/></label>
        <label>Assignment end date (exclusive)<input type="date" value={assignmentDates.endDate} onChange={event => setAssignmentDates({ ...assignmentDates, endDate: event.target.value })} required/></label>
        <label>Reason authorizing whole-class roster access<input value={assignmentDates.reason} onChange={event => setAssignmentDates({ ...assignmentDates, reason: event.target.value })} minLength={3} maxLength={500} required/></label>
        <button disabled={busy || !classOptions.length || !candidates.length}>Create teacher assignment</button>
      </form>
    </> : null}
  </section>;
}
