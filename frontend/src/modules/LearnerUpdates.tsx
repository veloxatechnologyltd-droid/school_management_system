import React, { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Empty, Pill, when } from '../lib/ui';

type Field = 'full_name' | 'date_of_birth' | 'sex';
type Change = { rowNumber: number; learnerId: string; admissionNumber: string; fullName: string; field: Field; from: string | null; to: string };
type Issue = { rowNumber: number; admissionNumber: string; message: string };
type Batch = { id: string; source_name?: string; status: string; version: number; changes: Change[]; issues: Issue[]; unchanged?: number };
type Summary = { id: string; source_name: string; status: string; changes: number; issues: number; created_at: string };
export const fieldLabel: Record<Field, string> = { full_name: 'Name', date_of_birth: 'Date of birth', sex: 'Sex' };

// Corrections to existing learners from a spreadsheet: stage and preview, then the headteacher applies with a reason.
export function LearnerUpdates({ schoolId, csrfToken, role, onApplied }: { schoolId: string; csrfToken: string; role: string; onApplied: () => void }) {
  const head = role === 'headteacher';
  const [csv, setCsv] = useState(''); const [sourceName, setSourceName] = useState(''); const [dateFormat, setDateFormat] = useState('dmy');
  const [batch, setBatch] = useState<Batch | null>(null); const [waiting, setWaiting] = useState<Summary[]>([]);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const loadWaiting = useCallback(() => request<{ items: Summary[] }>(`/schools/${schoolId}/learner-updates?limit=10`).then(r => setWaiting(r.items.filter(b => b.status === 'staged' && b.changes > 0 && !b.issues))).catch(() => undefined), [schoolId]);
  useEffect(() => { void loadWaiting(); }, [loadWaiting]);
  async function act(work: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const post = <T,>(path: string, body: object) => request<T>(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  const stage = (e: React.FormEvent) => { e.preventDefault(); void act(async () => { setBatch(await post<Batch>('/learner-updates', { sourceName: sourceName || 'pasted corrections', dateFormat, csv })); await loadWaiting(); }); };
  const apply = (e: React.FormEvent) => { e.preventDefault(); if (!batch) return; void act(async () => {
    const r = await post<{ learners: number; changes: number }>(`/learner-updates/${batch.id}/apply`, { version: batch.version, approvalReason: reason });
    setMessage(`Applied ${r.changes} correction(s) to ${r.learners} student(s). The old values are kept in each student's history.`); setBatch(null); setCsv(''); setReason(''); onApplied(); await loadWaiting();
  }); };
  const open = (id: string) => void act(async () => setBatch(await request<Batch>(`/schools/${schoolId}/learner-updates/${id}`)));

  return <div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!batch && <>
      <p className="muted">One row per student, found by admission number. Include only the columns to correct: Full Name, Date of Birth, Sex. Blank cells change nothing.</p>
      <form onSubmit={stage}>
        <label>CSV file<input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (file) { setSourceName(file.name); setCsv(await file.text()); } }}/></label>
        <label>Or paste the rows<textarea value={csv} onChange={e => setCsv(e.target.value)} rows={5} placeholder={'Admission No.,Full Name,Date of Birth,Sex\nNKB/0012,Kwame Mensah,04/05/2015,M'} required/></label>
        <label>Dates are written as<select value={dateFormat} onChange={e => setDateFormat(e.target.value)}><option value="dmy">Day/Month/Year (04/05/2015 = 4 May)</option><option value="mdy">Month/Day/Year</option><option value="iso">Year-Month-Day</option></select></label>
        <button disabled={busy || !csv.trim()}>Preview changes</button>
      </form>
      {waiting.length > 0 && <><h4>Waiting to be applied</h4><ul className="history">{waiting.map(b => <li key={b.id}><strong>{b.source_name}</strong><span>{b.changes} change(s) · staged {when(b.created_at)} <button type="button" className="secondary" onClick={() => open(b.id)}>Open</button></span></li>)}</ul></>}
    </>}
    {batch && <>
      {batch.status === 'applied' && <p><Pill tone="positive">Applied</Pill></p>}
      {batch.issues.length > 0 && <><h4>Problems to fix ({batch.issues.length})</h4><ul className="history">{batch.issues.map((i, n) => <li key={n}><strong>Row {i.rowNumber} · {i.admissionNumber || 'no admission number'}</strong><span>{i.message}</span></li>)}</ul>
        <p className="muted">Nothing is applied while any row has a problem. Correct the file and preview it again.</p></>}
      {batch.changes.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Field</th><th>Now</th><th>Will be</th></tr></thead><tbody>
        {batch.changes.map((c, n) => <tr key={n}><td>{c.fullName}<span className="sub">{c.admissionNumber}</span></td><td>{fieldLabel[c.field]}</td><td>{c.from ?? '—'}</td><td><strong>{c.to}</strong></td></tr>)}</tbody></table></div>
        : <Empty title="Nothing to change" hint="Every student in the file already matches the record."/>}
      {batch.unchanged ? <p className="muted">{batch.unchanged} row(s) already match and will not change.</p> : null}
      {batch.status === 'staged' && batch.changes.length > 0 && !batch.issues.length && (head
        ? <form onSubmit={apply}><label>Reason for these corrections<input value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} placeholder="Checked against birth certificates"/></label>
          <div className="actions"><button disabled={busy}>Apply {batch.changes.length} correction(s)</button><button type="button" className="secondary" onClick={() => setBatch(null)}>Back</button></div></form>
        : <p className="muted">Saved for the headteacher, who applies it from Students → Update from CSV.</p>)}
      {(!head || batch.status !== 'staged' || batch.issues.length > 0 || !batch.changes.length) && <button type="button" className="secondary" onClick={() => setBatch(null)}>Back</button>}
    </>}
  </div>;
}
