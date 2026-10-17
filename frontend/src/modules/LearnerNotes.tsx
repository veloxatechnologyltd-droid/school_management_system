import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Pill, when } from '../lib/ui';

export type Note = { id: string; authorRole: 'headteacher' | 'teacher' | 'guardian'; authorName: string; category: string; body: string; sharedWithFamily: boolean; createdAt: string;
  mine: boolean; canWithdraw: boolean; withdrawn: { at: string; reason: string } | null };
const noteCategories = [['general', 'General'], ['classwork', 'Class work'], ['behaviour', 'Behaviour'], ['attendance', 'Attendance'], ['health', 'Health'], ['home', 'Home']] as const;
const categoryLabel = (id: string) => noteCategories.find(([key]) => key === id)?.[1] ?? id;
const roleLabel = { headteacher: 'Headteacher', teacher: 'Teacher', guardian: 'Parent or parent' } as const;

// Notes on a learner between the school and the family. Staff choose whether a note is shared with the family;
// a family's note always goes to the school. A note is never edited: its author (or the headteacher) withdraws it with a reason.
export function NotesCard({ schoolId, csrfToken, learnerId, notes, family, onChanged }: { schoolId: string; csrfToken: string; learnerId: string; notes: Note[]; family?: boolean; onChanged: () => void }) {
  const [form, setForm] = useState({ category: family ? 'home' : 'classwork', body: '', share: false });
  const [withdrawing, setWithdrawing] = useState(''); const [reason, setReason] = useState('');
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const send = (path: string, body: object) => request(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage(done); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const add = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    await send(family ? `/guardian/children/${learnerId}/notes` : `/learners/${learnerId}/notes`, { category: form.category, body: form.body, ...(family ? {} : { sharedWithFamily: form.share }) });
    setForm({ ...form, body: '', share: false });
  }, family ? 'Note sent to the school.' : form.share ? 'Note saved and shared with the family.' : 'Note saved for staff.'); };
  const withdraw = (e: FormEvent) => { e.preventDefault(); void act(async () => { await send(`/learner-notes/${withdrawing}/withdraw`, { reason }); setWithdrawing(''); setReason(''); }, 'Note withdrawn. It stays in the history with your reason.'); };
  const live = notes.filter(n => !n.withdrawn), gone = notes.filter(n => n.withdrawn);
  return <Card title={family ? 'Notes with the school' : 'Notes'} hint={family ? 'Write to your child\'s teachers. Notes the school shares with you appear here too.' : 'Staff notes stay with staff unless you share them. Notes from the family are marked.'}>
    <form onSubmit={add} className="note-form">
      <label>About<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{noteCategories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="note-body">Note<textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required minLength={3} maxLength={2000} rows={3}
        placeholder={family ? 'For example: she was unwell this week and missed her homework.' : 'What you noticed, and anything agreed.'}/></label>
      {!family && <label className="check"><input type="checkbox" checked={form.share} onChange={e => setForm({ ...form, share: e.target.checked })}/><span>Share with the family (verified parents will see it)</span></label>}
      <div className="actions"><button disabled={busy || form.body.trim().length < 3}>{family ? 'Send to the school' : 'Add note'}</button></div>
    </form>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!live.length ? <Empty title="No notes yet" hint={family ? undefined : 'Notes from teachers, the headteacher and the family appear here, newest first.'}/>
      : <ul className="note-list">{live.map(n => <NoteItem key={n.id} note={n} family={family} onWithdraw={() => { setWithdrawing(n.id); setReason(''); }}/>)}</ul>}
    {withdrawing && <form onSubmit={withdraw} className="note-withdraw">
      <label>Why withdraw this note? The note and your reason stay in the history.<input value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={300}/></label>
      <div className="actions"><button disabled={busy}>Withdraw note</button><button type="button" className="secondary" onClick={() => setWithdrawing('')}>Cancel</button></div></form>}
    {gone.length > 0 && <><button type="button" className="link-button small-link" onClick={() => setShowWithdrawn(!showWithdrawn)}>{showWithdrawn ? 'Hide' : 'Show'} {gone.length} withdrawn note{gone.length === 1 ? '' : 's'}</button>
      {showWithdrawn && <ul className="note-list withdrawn">{gone.map(n => <NoteItem key={n.id} note={n} family={family}/>)}</ul>}</>}
  </Card>;
}

function NoteItem({ note: n, family, onWithdraw }: { note: Note; family?: boolean; onWithdraw?: () => void }) {
  return <li className={n.authorRole === 'guardian' ? 'from-family' : undefined}>
    <div className="note-meta"><strong>{n.mine ? 'You' : n.authorName}</strong><span className="muted">{roleLabel[n.authorRole]} · {when(n.createdAt)}</span>
      <Pill tone="neutral">{categoryLabel(n.category)}</Pill>
      {!family && n.authorRole !== 'guardian' && <Pill tone={n.sharedWithFamily ? 'info' : 'neutral'}>{n.sharedWithFamily ? 'Shared with family' : 'Staff only'}</Pill>}
      {!family && n.authorRole === 'guardian' && <Pill tone="caution">From the family</Pill>}</div>
    <p className="note-text">{n.body}</p>
    {n.withdrawn ? <p className="muted">Withdrawn {when(n.withdrawn.at)}: {n.withdrawn.reason}</p>
      : n.canWithdraw && onWithdraw && <button type="button" className="link-button small-link" onClick={onWithdraw}>Withdraw</button>}
  </li>;
}

// The parent portal's notes for one child.
export function FamilyNotes({ schoolId, csrfToken, childId }: { schoolId: string; csrfToken: string; childId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null); const [error, setError] = useState('');
  const load = useCallback(() => request<{ items: Note[] }>(`/schools/${schoolId}/guardian/children/${childId}/notes`).then(r => { setNotes(r.items); setError(''); }).catch(e => setError((e as Error).message)), [schoolId, childId]);
  useEffect(() => { setNotes(null); void load(); }, [load]);
  // Children the guardian may not see school matters for (no academic right) have no notes card.
  if (error) return null;
  if (!notes) return <p role="status" className="muted">Loading notes…</p>;
  return <NotesCard schoolId={schoolId} csrfToken={csrfToken} learnerId={childId} notes={notes} family onChanged={() => void load()}/>;
}
