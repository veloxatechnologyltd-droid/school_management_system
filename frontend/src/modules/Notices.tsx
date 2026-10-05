import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Stat, type Tone } from '../lib/ui';

type SchoolClass = { id: string; name: string; year_name: string };
type Notice = { id: string; title: string; body: string; audience: string; class_name: string | null; status: string; version: number; deliveries: Record<string, number> };
type Delivery = { id: string; guardian: string; phone: string | null; state: string; last_error: string | null };
const stateLabel: Record<string, string> = { queued: 'waiting to send', sending: 'sending', sent: 'sent by SMS', in_app_only: 'app only (no phone number)', suppressed: 'SMS switched off', failed: 'SMS failed', cancelled: 'cancelled' };
const empty = { title: '', body: '', audience: 'school', classId: '' };

export function Notices({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState<{ id: string; items: Delivery[] } | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const headers = { 'x-csrf-token': csrfToken };
  const load = useCallback(async () => {
    try { setNotices((await request<{ items: Notice[] }>(`/schools/${schoolId}/notices`)).items); }
    catch (e) { setError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void load(); request<{ items: SchoolClass[] }>(`/schools/${schoolId}/classes?limit=100`).then(r => setClasses(r.items)).catch(e => setError((e as Error).message)); }, [load, schoolId]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setNote('');
    try { await work(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const post = (path: string, body: object) => request<any>(`/schools/${schoolId}/notices${path}`, { method: 'POST', headers, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  const create = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    await post('', { title: form.title, body: form.body, audience: form.audience, ...(form.audience === 'class' ? { classId: form.classId } : {}) });
    setForm(empty); setComposing(false); setNote('Saved as a draft. Nothing is sent until you approve it.');
  }); };
  const approve = (n: Notice) => { if (window.confirm(`Send "${n.title}"? The guardians it reaches are fixed when you approve.`)) void act(async () => {
    const r = await post(`/${n.id}/approve`, { version: n.version });
    setNote(`Approved for ${r.recipients} guardian${r.recipients === 1 ? '' : 's'}; ${r.withPhone} will also get an SMS.`);
  }); };
  const cancel = (n: Notice) => { const reason = window.prompt(`Why cancel "${n.title}"? Messages not yet sent will be stopped.`); if (reason) void act(async () => { const r = await post(`/${n.id}/cancel`, { reason }); setNote(`Cancelled. ${r.unsentStopped} unsent message${r.unsentStopped === 1 ? '' : 's'} stopped.`); }); };
  const retry = (n: Notice) => void act(async () => { const r = await post(`/${n.id}/retry-failed`, {}); setNote(`${r.requeued} failed message${r.requeued === 1 ? '' : 's'} queued again.`); });
  const details = (n: Notice) => void act(async () => { setOpen({ id: n.id, items: (await request<{ items: Delivery[] }>(`/schools/${schoolId}/notices/${n.id}/deliveries`)).items }); });

  const sentCount = (n: Notice) => Object.values(n.deliveries).reduce((sum, count) => sum + count, 0);
  const statusTone: Record<string, Tone> = { draft: 'caution', approved: 'positive', cancelled: 'neutral' };
  const statusName: Record<string, string> = { draft: 'Draft', approved: 'Approved', cancelled: 'Cancelled' };
  const messages = <>{error && <p role="alert">{error}</p>}{note && <p role="status">{note}</p>}</>;
  const opened = open && notices.find(n => n.id === open.id);

  return <section aria-label="Notices to guardians" className="page">
    <PageHeader eyebrow="Communication" title="Notices" blurb="Short messages to guardians. Nothing is sent until you approve it."
      actions={<button type="button" onClick={() => { setError(''); setNote(''); setComposing(true); }}><Icon name="edit"/>New notice</button>}/>
    {!composing && !open && messages}
    <div className="stats">
      <Stat label="Drafts" value={notices.filter(n => n.status === 'draft').length} caption="Waiting for your approval" tone={notices.some(n => n.status === 'draft') ? 'caution' : 'neutral'} icon="drafts"/>
      <Stat label="Sent" value={notices.filter(n => n.status === 'approved').length} caption="Approved notices" tone="positive" icon="send"/>
      <Stat label="Guardians reached" value={notices.filter(n => n.status === 'approved').reduce((sum, n) => sum + sentCount(n), 0)} caption="Counted once per notice" icon="family_restroom"/>
    </div>
    <Card title="Notices to guardians" hint="Only guardians with a verified contact right receive a notice." flush>
      {notices.length ? <ul className="notice-list">{notices.map(n => <li key={n.id}>
        <div className="notice-head"><strong>{n.title}</strong><Pill tone={statusTone[n.status] ?? 'neutral'}>{statusName[n.status] ?? n.status}</Pill></div>
        <p>{n.body}</p>
        <span className="sub">{n.audience === 'class' ? n.class_name : 'Whole school'} · {Object.entries(n.deliveries).map(([state, count]) => `${count} ${stateLabel[state] ?? state}`).join(', ') || 'not sent yet'}</span>
        <div className="actions">
          {n.status === 'draft' && <button type="button" disabled={busy} onClick={() => approve(n)}>Approve and send</button>}
          {n.status === 'approved' && <button type="button" className="secondary" disabled={busy} onClick={() => details(n)}>Show recipients</button>}
          {n.status === 'approved' && (n.deliveries.failed ?? 0) > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => retry(n)}>Try failed SMS again</button>}
          {n.status !== 'cancelled' && <button type="button" className="secondary" disabled={busy} onClick={() => cancel(n)}>Cancel</button>}
        </div>
      </li>)}</ul> : <Empty title="No notices yet" hint="Write one for the whole school or a single class."/>}
    </Card>

    {composing && <Dialog title="New notice" onClose={() => setComposing(false)}>
      {messages}
      <p className="muted">Guardians see it in their app; those with a phone number on their account can also get an SMS.</p>
      <form onSubmit={create}>
        <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={3} maxLength={100}/></label>
        <label>Message<textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required minLength={3} maxLength={320} rows={3}/></label>
        <p className="muted">{form.body.length}/320 characters</p>
        <div className="grid"><label>Send to<select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}><option value="school">Whole school</option><option value="class">One class</option></select></label>
        {form.audience === 'class' && <label>Class<select value={form.classId} onChange={e => setForm({ ...form, classId: e.target.value })} required><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>}</div>
        <div className="actions"><button disabled={busy}>Save draft</button><button type="button" className="secondary" onClick={() => setComposing(false)}>Cancel</button></div>
      </form>
    </Dialog>}

    {opened && open && <Dialog title={`Recipients · ${opened.title}`} drawer onClose={() => setOpen(null)}>
      {messages}
      {open.items.length ? <div className="table-wrap"><table><thead><tr><th>Guardian</th><th>Delivery</th></tr></thead><tbody>{open.items.map(d => <tr key={d.id}><td>{d.guardian}{d.phone && <span className="sub">{d.phone}</span>}</td><td>{stateLabel[d.state] ?? d.state}{d.last_error && <span className="sub">{d.last_error}</span>}</td></tr>)}</tbody></table></div> : <Empty title="No recipients recorded"/>}
    </Dialog>}
  </section>;
}

export function GuardianNotices({ schoolId }: { schoolId: string }) {
  const [items, setItems] = useState<{ id: string; title: string; body: string; approved_at: string }[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { request<{ items: typeof items }>(`/schools/${schoolId}/guardian/notices`).then(r => setItems(r.items)).catch(e => setError((e as Error).message)); }, [schoolId]);
  return <section aria-label="Notices from the school" className="page">
    <PageHeader eyebrow="My family" title="Notices" blurb="Messages from the school, newest first."/>
    {error && <p role="alert">{error}</p>}
    {!items ? <p role="status">Loading notices…</p> : <Card title="Notices from the school" flush>
      {items.length ? <ul className="notice-list">{items.map(n => <li key={n.id}><div className="notice-head"><strong>{n.title}</strong><span className="sub">{new Date(n.approved_at).toLocaleDateString('en-GH', { timeZone: 'Africa/Accra', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></div><p>{n.body}</p></li>)}</ul> : <Empty title="No notices yet" hint="Messages from the school will appear here."/>}
    </Card>}
  </section>;
}
