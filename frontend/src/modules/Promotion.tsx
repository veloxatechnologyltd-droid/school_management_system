import React, { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, PageHeader, Stat } from '../lib/ui';

type SchoolClass = { id: string; name: string; year_name: string; start_date: string; end_date: string };
type Learner = { id: string; full_name: string; admission_number: string };

export function Promotion({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [source, setSource] = useState(''); const [effective, setEffective] = useState('');
  const [roster, setRoster] = useState<Learner[]>([]); const [choice, setChoice] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('End of year promotion');
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);

  const [loaded, setLoaded] = useState(false);
  // Opens on the first class; the new year starts when the next academic year with classes starts, else the day after this year ends.
  const nextYearStart = (rows: SchoolClass[], id: string) => { const from = rows.find(c => c.id === id); return from ? rows.map(c => c.start_date).filter(d => d > from.start_date).sort()[0] ?? from.end_date : ''; };
  useEffect(() => { request<{ items: SchoolClass[] }>(`/schools/${schoolId}/classes?limit=100`).then(r => { setClasses(r.items); if (r.items[0]) { setSource(r.items[0].id); setEffective(nextYearStart(r.items, r.items[0].id)); } }).catch(e => setError((e as Error).message)).finally(() => setLoaded(true)); }, [schoolId]);
  const chooseSource = (id: string) => { setSource(id); setEffective(prior => prior || nextYearStart(classes, id)); };
  async function loadRoster() {
    setError(''); setMessage(''); setRoster([]); setChoice({});
    try { setRoster((await request<{ items: Learner[] }>(`/schools/${schoolId}/promotions/preview?sourceClassId=${source}&effectiveDate=${effective}`)).items); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { if (source && effective) void loadRoster(); }, [source, effective]);
  const setAll = (value: string) => setChoice(Object.fromEntries(roster.map(l => [l.id, value])));
  async function run() {
    setBusy(true); setError(''); setMessage('');
    try {
      const decisions = roster.map(l => ({ learnerId: l.id, action: choice[l.id] === 'leave' ? 'leave' : 'move', ...(choice[l.id] && choice[l.id] !== 'leave' ? { classId: choice[l.id] } : {}) }));
      const r = await request<{ moved: number; left: number }>(`/schools/${schoolId}/promotions`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), sourceClassId: source, effectiveDate: effective, reason, decisions }) });
      setMessage(`Done: ${r.moved} moved, ${r.left} left the school.`); setRoster([]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const complete = roster.length > 0 && roster.every(l => choice[l.id]);
  const targets = classes.filter(c => c.id !== source);
  const decided = roster.filter(l => choice[l.id]).length;
  return <section aria-label="Year-end promotion" className="page">
    <PageHeader eyebrow="End of year" title="Promotion" blurb="Move each class into next year: promote, repeat or record that a learner left. Past enrolments stay in each learner's history."/>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <Card flush>
      <div className="toolbar">
        <label>Class being closed<select value={source} onChange={e => chooseSource(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
        <label>New year starts on<input type="date" value={effective} onChange={e => setEffective(e.target.value)}/></label>
        <button className="secondary" disabled={!source || !effective} onClick={() => void loadRoster()}>Show learners</button>
      </div>
      {!source ? (loaded && <Empty title={classes.length ? 'Choose the class you are closing' : 'No classes yet'} hint={classes.length ? 'Its learners appear here with one decision each.' : 'Add classes in Settings first.'}/>)
        : !effective ? <Empty title="Choose when the new year starts" hint="Add next year’s academic year and classes in Settings, then pick its first day."/>
        : !roster.length ? <Empty title="No learners to move" hint="Nobody is enrolled in this class on that date."/> : <>
          <div className="toolbar"><label>Set everyone to<select value="" onChange={e => setAll(e.target.value)}><option value="">Choose…</option>{targets.map(c => <option key={c.id} value={c.id}>Move to {c.name} · {c.year_name}</option>)}<option value="leave">Leave the school</option></select></label><span className="count">{decided} of {roster.length} decided</span></div>
          <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Decision</th></tr></thead><tbody>{roster.map(l => <tr key={l.id}><td>{l.full_name}<span className="sub">{l.admission_number}</span></td>
            <td><select aria-label={`Decision for ${l.full_name}`} value={choice[l.id] ?? ''} onChange={e => setChoice({ ...choice, [l.id]: e.target.value })}><option value="">Choose…</option>{targets.map(c => <option key={c.id} value={c.id}>Move to {c.name} · {c.year_name}</option>)}<option value="leave">Leave the school</option></select></td></tr>)}</tbody></table></div>
        </>}
    </Card>
    {roster.length > 0 && <>
      <div className="stats">
        <Stat label="Learners" value={roster.length} caption="In the class being closed" icon="groups"/>
        <Stat label="Moving" value={roster.filter(l => choice[l.id] && choice[l.id] !== 'leave').length} caption="Promoted or repeating" tone="positive" icon="trending_up"/>
        <Stat label="Leaving" value={roster.filter(l => choice[l.id] === 'leave').length} caption="Leave the school" icon="logout"/>
        <Stat label="Still to decide" value={roster.length - decided} caption="Every learner needs one" tone={roster.length - decided ? 'caution' : 'neutral'} icon="pending_actions"/>
      </div>
      <Card title="Apply promotion" hint="Nothing changes until every learner has a decision.">
        <label>Reason recorded in each history<input value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={400}/></label>
        <button disabled={busy || !complete} onClick={() => void run()}>{busy ? 'Working…' : 'Apply promotion'}</button>{!complete && <p className="muted">Choose a decision for every learner to continue.</p>}
      </Card>
    </>}
  </section>;
}
