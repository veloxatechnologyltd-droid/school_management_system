import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Icon, PageHeader, Pill, Stat, type Tone } from '../lib/ui';

type Props = { schoolId: string; csrfToken: string; role: string; accessRefresh: number };
type ClassRow = { id: string; name: string; level?: string; year_name?: string };
type Mark = 'unmarked' | 'present' | 'late' | 'absent' | 'excused';
type Learner = { id: string; full_name: string; admission_number: string; mark: Mark };
type Register = { id: string | null; status: 'draft' | 'submitted' | 'locked'; version: number; rosterSource: 'submission' | 'legacy_marks' | null; className: string; date: string; items: Learner[] };
const markNames: [Mark, string][] = [['present', 'Present'], ['late', 'Late'], ['absent', 'Absent'], ['excused', 'Excused']];
const statusTone: Record<Register['status'], Tone> = { draft: 'caution', submitted: 'positive', locked: 'neutral' };
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });

export function Attendance({ schoolId, csrfToken, role, accessRefresh }: Props) {
  const head = role === 'headteacher';
  const [day, setDay] = useState(today());
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState('');
  const [classSearchInput, setClassSearchInput] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [register, setRegister] = useState<Register | null>(null);
  const [open, setOpen] = useState(true);
  const [reason, setReason] = useState('');
  const [schoolDayVersion, setSchoolDayVersion] = useState<number | undefined>();
  const [dayLoading, setDayLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [correctionReason,setCorrectionReason]=useState('');
  const operations = useRef(new Map<string, string>());
  const classRequestEpoch = useRef(0);
  const lastAccessRefresh = useRef(accessRefresh);
  const autoPicked = useRef(false);

  useEffect(() => {
    const epoch = ++classRequestEpoch.current;
    const accessWasRefreshed = accessRefresh !== lastAccessRefresh.current;
    lastAccessRefresh.current = accessRefresh;
    if (!head && accessWasRefreshed) {
      setClasses([]); setClassId(''); setRegister(null);
    }
    const query = new URLSearchParams({ offset: '0', limit: '50' });
    if (!head) query.set('date', day);
    if (classSearch.trim()) query.set('search', classSearch.trim());
    request<{ items: ClassRow[] }>(`/schools/${schoolId}/teaching/${head ? 'class-options' : 'classes'}?${query.toString()}`)
      .then(page => {
        if (classRequestEpoch.current !== epoch) return;
        setClasses(page.items);
        // Open on the first class once, like the paper register on top of the pile.
        if (!autoPicked.current && !classId && page.items[0]) { autoPicked.current = true; setClassId(page.items[0].id); }
        if (!head && classId && !page.items.some(row => row.id === classId)) {
          setClassId(''); setRegister(null);
        }
      }).catch(e => {
        if (classRequestEpoch.current !== epoch) return;
        setClasses([]); setError((e as Error).message);
        if (!head) { setClassId(''); setRegister(null); }
      });
    return () => { classRequestEpoch.current++; };
  }, [accessRefresh, classSearch, day, head, schoolId]);

  useEffect(() => {
    setDayLoading(true);
    request<Array<{ version: number; is_open: boolean; reason: string }>>(`/schools/${schoolId}/attendance/school-days?day=${day}`)
      .then(rows => {
        const current = rows[0]; setSchoolDayVersion(current?.version);
        if (current) { setOpen(current.is_open); setReason(current.reason); }
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setDayLoading(false));
  }, [day, schoolId]);

  useEffect(() => {
    setRegister(null); setError(''); setCorrectionReason('');
    if (!classId) return;
    request<Register>(`/schools/${schoolId}/attendance/classes/${classId}/register?day=${day}`)
      .then(setRegister).catch(e => setError((e as Error).message));
  }, [classId, day, schoolId]);

  const operationId = (key: string) => {
    const existing = operations.current.get(key); if (existing) return existing;
    const id = crypto.randomUUID(); operations.current.set(key, id); return id;
  };
  async function post(path: string, payload: Record<string, unknown>, key: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<Partial<Register>>(path, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...payload, operationId: operationId(key) }) });
      operations.current.delete(key); setRegister(current => current ? { ...current, ...result } : null);
      const labels: Record<string, string> = { save: 'saved as draft', submit: 'submitted', lock: 'locked', correct: 'corrected' };
      setNotice(`Attendance ${labels[String(payload.action)] ?? 'saved'}.`);
      if(payload.action==='correct')setCorrectionReason('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function setSchoolDay() {
    setBusy(true); setError('');
    const operationKey = `day:${day}:${open}:${schoolDayVersion ?? 0}:${reason.trim()}`;
    try { const result = await request<{ version: number; is_open: boolean; reason: string }>('/schools/' + schoolId + '/attendance/school-days', { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: operationId(operationKey), day, isOpen: open, reason: reason.trim() || 'School day attendance review', ...(schoolDayVersion ? { version: schoolDayVersion } : {}) }) }); operations.current.delete(operationKey); setSchoolDayVersion(result.version); setOpen(result.is_open); setReason(result.reason); setNotice(`School day ${result.version > 1 ? 'updated' : 'saved'}.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const marks = register?.items.map(row => ({ learnerId: row.id, mark: row.mark })) ?? [];
  const action = register?.status === 'draft' ? 'submit' : 'correct';
  const locked = register?.status === 'locked' && !head;
  const setMark = (id: string, mark: Mark) => register && setRegister({ ...register, items: register.items.map(item => item.id === id ? { ...item, mark } : item) });
  const count = (mark: Mark) => register?.items.filter(row => row.mark === mark).length ?? 0;
  return <section aria-labelledby="attendance-title" className="page">
    <PageHeader id="attendance-title" eyebrow="Daily register" title="Attendance" blurb="One dated register per class. Changes after submission need a reason."/>
    {error && (register || !classId) && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    {register && <div className="stats">
      <Stat label="Present" value={count('present')} caption={`of ${register.items.length} learners`} tone="positive"/>
      <Stat label="Late" value={count('late')} tone="caution"/>
      <Stat label="Absent" value={count('absent')} caption={count('excused') ? `${count('excused')} excused` : undefined} tone="critical"/>
      <Stat label="Not marked" value={count('unmarked')} tone={count('unmarked') ? 'caution' : 'neutral'}/>
    </div>}
    <div className="columns">
      <Card flush>
        <div className="toolbar">
          <label>Date<input type="date" value={day} onChange={e => { setDay(e.target.value); setClassId(''); setSchoolDayVersion(undefined); setDayLoading(true); }} /></label>
          <label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">Choose a class</option>{classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <form onSubmit={e => { e.preventDefault(); setClassSearch(classSearchInput.trim()); setClassId(''); }}><label className="search"><Icon name="search"/><input aria-label="Find a class" value={classSearchInput} onChange={e => setClassSearchInput(e.target.value)} placeholder="Find a class" /></label><button className="secondary" type="submit" disabled={busy}>Find class</button></form>
        </div>
        {!register ? <Empty title={!classId ? 'Choose a class' : error ? 'This register cannot open' : 'Loading register…'} hint={!classId ? 'Pick a class and date to open its register.' : error || undefined}/> : <>
          <div className="card-head"><div><h3>{register.className} · {register.date}</h3><p className="card-hint">Status: {register.status}. {register.status==='draft'?'Every currently enrolled learner appears once.':'The roster captured for this register is retained.'}</p></div>
            <div className="actions"><Pill tone={statusTone[register.status]}>{register.status}</Pill>{!locked && register.items.length > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => setRegister({ ...register, items: register.items.map(item => item.mark === 'unmarked' ? { ...item, mark: 'present' } : item) })}>Mark the rest present</button>}</div></div>
          {register.rosterSource==='legacy_marks'&&<p role="status">This older roster was recovered from saved marks. Review it against school records; original submission-time names and membership may be incomplete.</p>}
          {!register.items.length ? <Empty title="No learners in this register"/> : <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Mark</th></tr></thead><tbody>{register.items.map(row => <tr key={row.id}>
            <td><span>{row.full_name}</span><span className="sub">{row.admission_number}</span></td>
            <td><div className="mark-group" role="group" aria-label={`Attendance for ${row.full_name}`}>{markNames.map(([mark, name]) => <button key={mark} type="button" className={`m-${mark}`} aria-pressed={row.mark === mark} disabled={busy || locked} onClick={() => setMark(row.id, mark)}>{name}</button>)}</div></td>
          </tr>)}</tbody></table></div>}
          <div className="pager">
            <span>{count('unmarked') ? `${count('unmarked')} not marked yet` : 'Everyone is marked'}</span>
            <div className="actions">
              {register.status==='draft'&&<button type="button" className="secondary" disabled={busy} onClick={() => void post(`/schools/${schoolId}/attendance/classes/${classId}/register`, { day, version: register.version, action: 'save', marks }, `register:${classId}:${day}:save`)}>Save draft</button>}
              {(register.status !== 'locked' || head)&&<>
                {action === 'correct' && <input aria-label="Correction reason" placeholder="Correction reason" minLength={3} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} />}
                <button type="button" disabled={busy || (action === 'correct' && correctionReason.trim().length < 3)} onClick={() => void post(`/schools/${schoolId}/attendance/classes/${classId}/register`, { day, version: register.version, action, marks, ...(action === 'correct' ? { correctionReason: correctionReason.trim() } : {}) }, `register:${classId}:${day}:${action}:${register.version}`)}>{action === 'submit' ? 'Submit register' : 'Save correction'}</button>
                {head&&register.status==='submitted'&&<button className="secondary" type="button" disabled={busy} onClick={()=>void post(`/schools/${schoolId}/attendance/classes/${classId}/register`,{day,version:register.version,action:'lock',marks},`register:${classId}:${day}:lock:${register.version}`)}>Lock register</button>}
              </>}
            </div>
          </div>
        </>}
      </Card>
      {head && <Card title="School day" hint={`Is ${day} a school day?`}>
        <label><input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /> School day open</label>
        <label>Reason<input aria-label="School day reason" placeholder="For example: mid-term break" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label>
        <button className="secondary" type="button" disabled={busy || dayLoading} onClick={() => void setSchoolDay()}>Save school day</button>
      </Card>}
    </div>
  </section>;
}
