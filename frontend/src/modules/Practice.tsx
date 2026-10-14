import React, { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Dialog, Empty, Pill } from '../lib/ui';

export type Resource = { id: string; kind: string; title: string; detail: string | null; url: string | null; for_families: boolean; mine?: boolean; retired_at?: string | null; retirement_reason?: string | null };
const kinds = [['worksheet', 'Worksheet'], ['textbook', 'Textbook pages'], ['link', 'Link'], ['activity', 'Activity']] as const;
const kindLabel = (k: string) => kinds.find(([id]) => id === k)?.[1] ?? k;

// A short read-only list, used inside a support plan.
export function PracticeList({ items }: { items: Resource[] }) {
  return <ul className="practice-list">{items.map(r => <li key={r.id}><Pill tone="info">{kindLabel(r.kind)}</Pill>
    <span>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : <strong>{r.title}</strong>}{r.detail && <span className="sub">{r.detail}</span>}</span>
    {r.for_families && <Pill tone="positive">For families</Pill>}</li>)}</ul>;
}

// Practice materials for one indicator: what the school uses to re-teach it, added by any teacher.
export function PracticeDialog({ schoolId, csrfToken, indicatorId, onClose, onChanged }: { schoolId: string; csrfToken: string; indicatorId: string; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<{ indicator: { code: string | null; description: string; retired_at: string | null }; canRetireAny: boolean; items: Resource[] } | null>(null);
  const [form, setForm] = useState({ kind: 'worksheet', title: '', detail: '', url: '', forFamilies: false });
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [showRetired, setShowRetired] = useState(false);
  const load = () => request<NonNullable<typeof data>>(`/schools/${schoolId}/assessment/indicators/${indicatorId}/resources`).then(setData).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, [schoolId, indicatorId]);
  const send = (path: string, body: object) => request(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  async function act(work: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const add = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    await send(`/assessment/indicators/${indicatorId}/resources`, { kind: form.kind, title: form.title, ...(form.detail.trim() ? { detail: form.detail.trim() } : {}), ...(form.url.trim() ? { url: form.url.trim() } : {}), forFamilies: form.forFamilies });
    setForm({ ...form, title: '', detail: '', url: '', forFamilies: false }); await load(); onChanged?.(); setMessage('Practice material added.'); }); };
  const retire = (r: Resource) => { const reason = window.prompt(`Why is "${r.title}" being retired?`); if (!reason || reason.trim().length < 3) return;
    void act(async () => { await send(`/assessment/indicator-resources/${r.id}/retire`, { reason }); await load(); onChanged?.(); setMessage('Retired.'); }); };
  const current = data?.items.filter(r => !r.retired_at) ?? [], retired = data?.items.filter(r => r.retired_at) ?? [];
  return <Dialog title={data ? `Practice: ${data.indicator.code ? `${data.indicator.code} ` : ''}${data.indicator.description}` : 'Practice materials'} wide onClose={onClose}>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && <>
      {!current.length ? <Empty title="No practice materials yet" hint="Add the worksheet, textbook pages or activity you use to re-teach this."/>
        : <ul className="practice-list">{current.map(r => <li key={r.id}><Pill tone="info">{kindLabel(r.kind)}</Pill>
          <span>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : <strong>{r.title}</strong>}{r.detail && <span className="sub">{r.detail}</span>}</span>
          {r.for_families && <Pill tone="positive">For families</Pill>}
          {(data.canRetireAny || r.mine) && <button type="button" className="secondary small" disabled={busy} onClick={() => retire(r)}>Retire</button>}</li>)}</ul>}
      {retired.length > 0 && <p><button type="button" className="link-button" onClick={() => setShowRetired(!showRetired)}>{showRetired ? 'Hide' : 'Show'} {retired.length} retired</button></p>}
      {showRetired && <ul className="history">{retired.map(r => <li key={r.id}><strong>{r.title}</strong><span>Retired: {r.retirement_reason}</span></li>)}</ul>}
      {!data.indicator.retired_at && <form onSubmit={add} className="review-form"><h4>Add practice</h4>
        <div className="field-row"><label>Type<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={3} maxLength={160} placeholder="e.g. Fractions practice sheet 2"/></label></div>
        <label>Pages or instructions{form.kind === 'link' ? ' (optional)' : ''}<input value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} maxLength={500} placeholder={form.kind === 'textbook' ? 'e.g. Primary Maths Book 5, pages 34 to 36' : 'e.g. Do questions 1 to 10; check answers together'}/></label>
        <label>Link (optional)<input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} maxLength={500} placeholder="https://… (a shared drive file, for example)"/></label>
        <label className="check"><input type="checkbox" checked={form.forFamilies} onChange={e => setForm({ ...form, forFamilies: e.target.checked })}/><span>Suitable for families to use at home</span></label>
        <button disabled={busy || (!form.detail.trim() && !form.url.trim())}>Add</button>
      </form>}
    </>}
  </Dialog>;
}
