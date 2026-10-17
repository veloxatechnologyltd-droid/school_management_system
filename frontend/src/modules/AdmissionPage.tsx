import React, { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { SchoolLogo } from '../lib/logo';
import { Card, Empty, Icon, PageHeader, Pill } from '../lib/ui';
import { actionsFor, nextStep, statusNames, statusTone } from '../lib/admissions';

type Step = 'created' | 'review' | 'offered' | 'waitlisted' | 'declined' | 'accepted' | 'enrolled';
type Application = {
  id: string; full_name: string; date_of_birth: string | null; sex: 'female' | 'male' | null; status: string; class_name: string; level: string; year_name: string;
  start_date: string; admission_number: string; version: number; learner_id: string | null; decision_reason: string | null; created_at: string;
  guardian_name: string | null; guardian_relationship: string | null; guardian_phone: string | null;
  timeline: { step: Step; at: string; by: string | null; reason: string | null; capacityOverride: boolean }[];
  notes: { id: string; note: string; author_name: string; created_at: string }[];
  parents: { name: string; verified: boolean }[];
};

const actionNames: Record<string, string> = { review: 'Start review', offer: 'Offer place', waitlist: 'Waitlist', decline: 'Decline', accept: 'Record acceptance', enrol: 'Enrol student' };
const stepNames: Record<Step, string> = { created: 'Application received', review: 'Review started', offered: 'Place offered', waitlisted: 'Put on the waitlist', declined: 'Declined', accepted: 'Family accepted the place', enrolled: 'Enrolled' };

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const accraToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
function ageOn(dob: string, today: string) { const [y, m, d] = dob.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number); return ty! - y! - (tm! < m! || (tm === m && td! < d!) ? 1 : 0); }
const localPhone = (phone: string) => phone.replace(/^\+233(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3');

// One application on one page: where it stands and what to do next, the child and the family, every decision with
// who made it and when, and the staff's notes. Families never see this page.
export function AdmissionPage({ schoolId, csrfToken, role, admissionId }: { schoolId: string; csrfToken: string; role: string; admissionId: string }) {
  const [data, setData] = useState<Application | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(''); const [override, setOverride] = useState(''); const [note, setNote] = useState('');
  const operations = useRef(new Map<string, { payload: string; id: string }>());
  const load = useCallback(async () => {
    try { setData(await request<Application>(`/schools/${schoolId}/admissions/${admissionId}`)); } catch (e) { setError((e as Error).message); }
  }, [schoolId, admissionId]);
  useEffect(() => { void load(); }, [load]);
  // A retried request reuses its operation ID so the server applies it once.
  const operationId = (key: string, payload: unknown) => {
    const serialized = JSON.stringify(payload), prior = operations.current.get(key);
    if (prior?.payload === serialized) return prior.id;
    const next = { payload: serialized, id: crypto.randomUUID() }; operations.current.set(key, next); return next.id;
  };
  async function send(key: string, url: string, payload: Record<string, unknown>, done: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await request(url, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...payload, operationId: operationId(key, payload) }) });
      operations.current.delete(key); setNotice(done); await load(); return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  async function decide(action: string) {
    if (!data) return;
    const payload = { version: data.version, action, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(action === 'enrol' && override.trim() ? { capacityOverrideReason: override.trim() } : {}) };
    if (await send(`transition:${action}`, `/schools/${schoolId}/admissions/${admissionId}/transition`, payload, `${actionNames[action]}: saved.`)) { setReason(''); setOverride(''); }
  }
  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (await send('note', `/schools/${schoolId}/admissions/${admissionId}/notes`, { note: note.trim() }, 'Note added.')) setNote('');
  }
  const back = () => history.length > 1 ? history.back() : (location.hash = '#/students/applications');
  if (error && !data) return <section className="page"><PageHeader eyebrow="Application" title="Application unavailable" blurb={error} actions={<button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>}/></section>;
  if (!data) return <p role="status">Loading…</p>;

  const actions = actionsFor(data.status), needsReason = actions.some(a => a === 'waitlist' || a === 'decline');
  const facts = [`Applied for ${data.class_name} (${data.year_name})`, `Admission no. ${data.admission_number}`, `Received ${day(data.created_at)}`].join(' · ');
  return <section className="page admission-page" aria-label={`Application for ${data.full_name}`}>
    <PageHeader eyebrow="Application" title={data.full_name} blurb={facts} actions={<button type="button" className="secondary" onClick={back}><Icon name="arrow_back"/>Back</button>}/>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    <Card title="Where it stands">
      <dl className="admission-stand">
        <div><dt>Stage</dt><dd><Pill tone={statusTone[data.status] ?? 'neutral'}>{statusNames[data.status] ?? data.status}</Pill></dd></div>
        <div><dt>Class applied for</dt><dd>{data.class_name} · {data.level}</dd></div>
        <div><dt>Starts</dt><dd>{day(data.start_date)}</dd></div>
        <div className="admission-next"><dt>Next step</dt><dd>{nextStep(data.status, data.class_name)}</dd></div>
      </dl>
      {data.decision_reason && <p className="muted">Last decision note: {data.decision_reason}</p>}
      {actions.length > 0 && <div className="admission-decide">
        {needsReason && <label>Reason (needed to waitlist or decline)<input value={reason} onChange={e => setReason(e.target.value)} maxLength={500}/></label>}
        {data.status === 'accepted' && role === 'headteacher' && <label>Capacity override reason (only if the class is full)<input value={override} onChange={e => setOverride(e.target.value)} maxLength={500}/></label>}
        <div className="actions">{actions.map(action => <button type="button" key={action} className={action === 'decline' || action === 'waitlist' ? 'secondary' : undefined} disabled={busy} onClick={() => void decide(action)}>{actionNames[action]}</button>)}</div>
      </div>}
      {data.learner_id && role === 'headteacher' && <p><a className="learner-link" href={`#/learner/${data.learner_id}`}>Open the student page</a></p>}
    </Card>
    <div className="columns">
      <div className="stack">
        <Card title="Child">
          <dl className="doc-facts">
            <div><dt>Full name</dt><dd>{data.full_name}</dd></div>
            <div><dt>Date of birth</dt><dd>{data.date_of_birth ? `${day(data.date_of_birth)} (${ageOn(data.date_of_birth, accraToday())} years)` : 'Not recorded'}</dd></div>
            <div><dt>Sex</dt><dd>{data.sex === 'female' ? 'Female' : data.sex === 'male' ? 'Male' : 'Not recorded'}</dd></div>
            <div><dt>Admission number</dt><dd>{data.admission_number}</dd></div>
          </dl>
        </Card>
        <Card title="Parent or guardian">
          {data.guardian_name ? <dl className="doc-facts">
            <div><dt>Name</dt><dd>{data.guardian_name}</dd></div>
            <div><dt>Relationship</dt><dd>{data.guardian_relationship ?? 'Not recorded'}</dd></div>
            <div><dt>Phone</dt><dd>{data.guardian_phone ? <a href={`tel:${data.guardian_phone}`}>{localPhone(data.guardian_phone)}</a> : 'Not recorded'}</dd></div>
          </dl> : <p className="muted">Not given on the application.</p>}
          {data.learner_id && <><h4>Parent accounts</h4>{data.parents.length
            ? <ul className="history">{data.parents.map((p, i) => <li key={i}><strong>{p.name}</strong><span>{p.verified ? 'Verified' : 'Waiting to be verified'}</span></li>)}</ul>
            : <p className="muted">No parent account linked yet. Link one on the Parents page.</p>}</>}
        </Card>
      </div>
      <div className="stack">
        <Card title="Decisions" hint="Every step, who took it and when.">
          <ol className="timeline">{data.timeline.map((e, i) => <li key={i}>
            <strong>{stepNames[e.step] ?? e.step}</strong>
            <span>{when(e.at)}{e.by ? ` · ${e.by}` : ''}</span>
            {e.reason && <span>Reason: {e.reason}</span>}
            {e.capacityOverride && <span>Class capacity was overridden.</span>}
          </li>)}</ol>
        </Card>
        <Card title="Staff notes" hint="Only staff see these. A note is kept as written.">
          <form onSubmit={addNote}>
            <label>New note<textarea value={note} onChange={e => setNote(e.target.value)} required minLength={3} maxLength={1000} rows={3}/></label>
            <button disabled={busy || note.trim().length < 3}>Add note</button>
          </form>
          {data.notes.length ? <ul className="history">{data.notes.map(n => <li key={n.id}><span className="note-text">{n.note}</span><span>{n.author_name} · {when(n.created_at)}</span></li>)}</ul> : <Empty title="No notes yet"/>}
        </Card>
      </div>
    </div>
  </section>;
}

// A blank admission form for a family to fill in by hand at the front desk, with the school's heading and crest.
export function BlankAdmissionForm({ schoolId }: { schoolId: string }) {
  const [school, setSchool] = useState<{ name: string; motto?: string | null; address?: string | null; phone?: string | null } | null>(null);
  useEffect(() => { void request<NonNullable<typeof school>>(`/schools/${schoolId}`).then(setSchool).catch(() => undefined); }, [schoolId]);
  const line = (label: string) => <div key={label}><span className="doc-line"/>{label}</div>;
  return <>
    <div className="actions"><button type="button" onClick={() => window.print()}><Icon name="print"/>Print</button></div>
    <article className="receipt admission-form">
      <header className="doc-head">
        <SchoolLogo schoolId={schoolId} className="doc-logo"/>
        <div className="doc-school"><h3>{school?.name ?? ''}</h3>{school?.motto && <p className="report-motto">{school.motto}</p>}{(school?.address || school?.phone) && <p>{[school.address, school.phone].filter(Boolean).join(' · ')}</p>}</div>
        <div className="doc-title"><strong>Admission form</strong><span>Office use: No. ________</span></div>
      </header>
      <h4>The child</h4>
      <div className="form-lines">{['Full name', 'Date of birth', 'Girl or boy', 'Class applying for', 'Start date wanted', 'Last school attended'].map(line)}</div>
      <h4>Parent or guardian</h4>
      <div className="form-lines">{['Full name', 'Relationship to the child', 'Mobile number', 'Home address'].map(line)}</div>
      <footer className="doc-sign">
        <div><span className="doc-line"/>Parent's signature and date</div>
        <div><span className="doc-line"/>Received by (school)</div>
        <div className="doc-stamp">School stamp</div>
      </footer>
    </article>
  </>;
}
