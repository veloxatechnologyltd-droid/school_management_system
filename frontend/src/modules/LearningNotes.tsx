import React, { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Pill, when } from '../lib/ui';

type Item = { id: string; note: string; until: string | null; authorName: string; createdAt: string; mine: boolean; canWithdraw: boolean;
  indicator: { id: string; subject: string; topic: string } | null; withdrawn: { at: string; reason: string } | null };
type Data = { items: Item[]; topics: { indicatorId: string; subject: string; topic: string }[] };
const untilText = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

// A teacher's learning notes for one student: how to help, optionally with a topic to put first on the student's list. Staff only: families never
// see them. A note is never edited; its author or the headteacher withdraws it with a reason, and it stays in the history.
export function LearningNotes({ schoolId, csrfToken, learnerId }: { schoolId: string; csrfToken: string; learnerId: string }) {
  const [data, setData] = useState<Data | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(''); const [topic, setTopic] = useState(''); const [until, setUntil] = useState('');
  const [withdrawing, setWithdrawing] = useState(''); const [reason, setReason] = useState(''); const [history, setHistory] = useState(false);
  const base = `/schools/${schoolId}`;
  const load = () => request<Data>(`${base}/learners/${learnerId}/learning-notes`).then(setData).catch(e => setError((e as Error).message));
  useEffect(() => { setData(null); setError(''); void load(); }, [schoolId, learnerId]);
  const send = (path: string, body: object) => request(`${base}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  async function act(work: () => Promise<unknown>, done: string) { setBusy(true); setError(''); setMessage(''); try { await work(); setMessage(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const add = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    await send(`/learners/${learnerId}/learning-notes`, { note: note.trim(), ...(topic ? { indicatorId: topic } : {}), ...(topic && until ? { until } : {}) });
    setNote(''); setTopic(''); setUntil('');
  }, 'Note saved for staff.'); };
  const withdraw = (e: FormEvent) => { e.preventDefault(); void act(async () => { await send(`/learning-notes/${withdrawing}/withdraw`, { reason: reason.trim() }); setWithdrawing(''); setReason(''); }, 'Note withdrawn. It stays in the history.'); };
  if (!data) return error ? <Card title="Learning notes"><p role="alert">{error}</p></Card> : null;
  const live = data.items.filter(n => !n.withdrawn), gone = data.items.filter(n => n.withdrawn);
  return <Card title="Learning notes" hint="How to help this student. For staff only: parents never see these, and a topic you choose here simply comes first on the student's practice list.">
    <form onSubmit={add} className="note-form">
      <label className="note-body">How to help this student<textarea value={note} onChange={e => setNote(e.target.value)} required minLength={5} maxLength={240} rows={2}
        placeholder="For example: use money examples, and keep instructions short"/></label>
      <div className="field-row">
        <label>Topic to put first (optional)<select value={topic} onChange={e => setTopic(e.target.value)}><option value="">No topic</option>{data.topics.map(t => <option key={t.indicatorId} value={t.indicatorId}>{t.subject}: {t.topic}</option>)}</select></label>
        {topic && <label>Keep it first until (optional)<input type="date" value={until} onChange={e => setUntil(e.target.value)}/></label>}
      </div>
      <p className="field-hint muted">Leave out the student's name, health and family matters: use a school note for those.</p>
      <div className="actions"><button disabled={busy || note.trim().length < 5}>Add learning note</button></div>
    </form>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!live.length ? <Empty title="No learning notes yet" hint="Add one when you learn something that helps this student."/>
      : <ul className="note-list">{live.map(n => <li key={n.id}><p>{n.note}</p>
        <span className="sub">{n.authorName}, {when(n.createdAt)}{n.indicator && <> · <Pill tone="info">First: {n.indicator.topic}{n.until ? ` until ${untilText(n.until)}` : ''}</Pill></>}</span>
        {n.canWithdraw && (withdrawing === n.id
          ? <form onSubmit={withdraw} className="retire-form"><label>Why? (kept with your name)<input value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={300} required autoFocus/></label>
            <div className="actions"><button className="small" disabled={busy || reason.trim().length < 3}>Withdraw note</button><button type="button" className="secondary small" onClick={() => setWithdrawing('')}>Cancel</button></div></form>
          : <button type="button" className="secondary small" onClick={() => { setWithdrawing(n.id); setReason(''); }}>Withdraw</button>)}</li>)}</ul>}
    {gone.length > 0 && <><button type="button" className="link-button small-link" onClick={() => setHistory(!history)}>{history ? 'Hide' : 'Show'} {gone.length} withdrawn note{gone.length === 1 ? '' : 's'}</button>
      {history && <ul className="note-list withdrawn">{gone.map(n => <li key={n.id}><p>{n.note}</p><span className="sub">{n.authorName}, {when(n.createdAt)} · withdrawn {when(n.withdrawn!.at)}: {n.withdrawn!.reason}</span></li>)}</ul>}</>}
  </Card>;
}
