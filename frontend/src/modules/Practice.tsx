import React, { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Dialog, Empty, Icon, Pill, Tabs } from '../lib/ui';
import { PracticeQuestions } from './PracticeQuestions';

export type Resource = { id: string; kind: string; title: string; detail: string | null; url: string | null; for_families: boolean; mine?: boolean; retired_at?: string | null; retirement_reason?: string | null };
const kinds = [['worksheet', 'Worksheet'], ['textbook', 'Textbook pages'], ['link', 'Link'], ['activity', 'Activity']] as const;
const kindLabel = (k: string) => kinds.find(([id]) => id === k)?.[1] ?? k;
type Sheet = { runId: string; source: string; note: string | null; title: string; questions: string[]; answers: string[]; homeTip: string | null; detail: string };
const escape = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// A plain printable sheet for learners: title, numbered questions and space to answer. Answers stay with the teacher.
function printSheet(title: string, detail: string) {
  const questions = detail.split(/\s(?=\d+\.\s)/).map(q => q.replace(/^\d+\.\s*/, ''));
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:32px;max-width:720px}h1{font-size:20px}li{margin:0 0 40px}p{color:#555}</style><h1>${escape(title)}</h1><p>Name: ____________________ &nbsp; Date: ____________</p><ol>${questions.map(q => `<li>${escape(q)}</li>`).join('')}</ol>`);
  w.document.close(); w.focus(); w.print();
}

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
  const [sheet, setSheet] = useState<Sheet | null>(null); const [tab, setTab] = useState<'materials' | 'questions'>('materials');
  const load = () => request<NonNullable<typeof data>>(`/schools/${schoolId}/assessment/indicators/${indicatorId}/resources`).then(setData).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, [schoolId, indicatorId]);
  const send = (path: string, body: object) => request(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  async function act(work: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const add = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    await send(`/assessment/indicators/${indicatorId}/resources`, { kind: form.kind, title: form.title, ...(form.detail.trim() ? { detail: form.detail.trim() } : {}), ...(form.url.trim() ? { url: form.url.trim() } : {}), forFamilies: form.forFamilies });
    if (sheet) void request(`/schools/${schoolId}/ai/runs/${sheet.runId}/feedback`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ outcome: form.title === sheet.title && form.detail.trim() === sheet.detail ? 'accepted' : 'edited' }) }).catch(() => undefined);
    setForm({ ...form, title: '', detail: '', url: '', forFamilies: false }); setSheet(null); await load(); onChanged?.(); setMessage('Practice material added.'); }); };
  // Drafts a short worksheet for this indicator (Claude when the school has AI on, otherwise an outline). It fills the form; nothing is saved until Add.
  const draftSheet = () => void act(async () => {
    const r = await request<Sheet>(`/schools/${schoolId}/ai/indicators/${indicatorId}/worksheet-draft`, { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
    setSheet(r); setForm({ kind: 'worksheet', title: r.title, detail: r.detail, url: '', forFamilies: false });
    setMessage(r.source === 'ai' ? 'Worksheet drafted with Claude. Check every question and answer before adding it.' : 'AI drafting is off, so this is an outline to complete. Replace the questions with your own before adding it.');
  });
  const addTip = () => sheet?.homeTip && void act(async () => {
    await send(`/assessment/indicators/${indicatorId}/resources`, { kind: 'activity', title: `At home: ${data?.indicator.description ?? 'practice'}`.slice(0, 160), detail: sheet.homeTip, forFamilies: true });
    setSheet({ ...sheet, homeTip: null }); await load(); onChanged?.(); setMessage('Home activity added for families.'); });
  const retire = (r: Resource) => { const reason = window.prompt(`Why is "${r.title}" being retired?`); if (!reason || reason.trim().length < 3) return;
    void act(async () => { await send(`/assessment/indicator-resources/${r.id}/retire`, { reason }); await load(); onChanged?.(); setMessage('Retired.'); }); };
  const current = data?.items.filter(r => !r.retired_at) ?? [], retired = data?.items.filter(r => r.retired_at) ?? [];
  return <Dialog title={data ? `Practice: ${data.indicator.code ? `${data.indicator.code} ` : ''}${data.indicator.description}` : 'Practice materials'} wide onClose={onClose}>
    <Tabs label="Practice" value={tab} onChange={setTab} options={[{ id: 'materials', label: 'Materials' }, { id: 'questions', label: 'Home practice questions' }]}/>
    {tab === 'questions' && <PracticeQuestions schoolId={schoolId} csrfToken={csrfToken} indicatorId={indicatorId} onChanged={onChanged}/>}
    {tab === 'materials' && <>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && <>
      {!current.length ? <Empty title="No practice materials yet" hint="Add the worksheet, textbook pages or activity you use to re-teach this."/>
        : <ul className="practice-list">{current.map(r => <li key={r.id}><Pill tone="info">{kindLabel(r.kind)}</Pill>
          <span>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : <strong>{r.title}</strong>}{r.detail && <span className="sub">{r.detail}</span>}</span>
          {r.for_families && <Pill tone="positive">For families</Pill>}
          {(data.canRetireAny || r.mine) && <button type="button" className="secondary small" disabled={busy} onClick={() => retire(r)}>Retire</button>}</li>)}</ul>}
      {retired.length > 0 && <p><button type="button" className="link-button" onClick={() => setShowRetired(!showRetired)}>{showRetired ? 'Hide' : 'Show'} {retired.length} retired</button></p>}
      {showRetired && <ul className="history">{retired.map(r => <li key={r.id}><strong>{r.title}</strong><span>Retired: {r.retirement_reason}</span></li>)}</ul>}
      {!data.indicator.retired_at && <form onSubmit={add} className="review-form"><div className="form-head"><h4>Add practice</h4><button type="button" className="secondary small" disabled={busy} onClick={draftSheet}><Icon name="auto_awesome"/>Draft a worksheet</button></div>
        <div className="field-row"><label>Type<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={3} maxLength={160} placeholder="e.g. Fractions practice sheet 2"/></label></div>
        <label>Pages or instructions{form.kind === 'link' ? ' (optional)' : ''}<textarea rows={sheet ? 5 : 2} value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} maxLength={500} placeholder={form.kind === 'textbook' ? 'e.g. Primary Maths Book 5, pages 34 to 36' : 'e.g. Do questions 1 to 10; check answers together'}/></label>
        <label>Link (optional)<input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} maxLength={500} placeholder="https://… (a shared drive file, for example)"/></label>
        <label className="check"><input type="checkbox" checked={form.forFamilies} onChange={e => setForm({ ...form, forFamilies: e.target.checked })}/><span>Suitable for families to use at home</span></label>
        {sheet && <div className="sheet-extras">
          {sheet.source === 'ai' && <><h5>Answers (for you, not printed)</h5><ol>{sheet.answers.map((a, i) => <li key={i}>{a}</li>)}</ol></>}
          {sheet.homeTip && <p><strong>Idea for home:</strong> {sheet.homeTip} <button type="button" className="link-button" disabled={busy} onClick={addTip}>Add as a home activity for families</button></p>}
        </div>}
        <div className="actions"><button disabled={busy || (!form.detail.trim() && !form.url.trim())}>Add</button>
          {form.kind === 'worksheet' && form.detail.trim() && <button type="button" className="secondary" onClick={() => printSheet(form.title || 'Practice', form.detail)}><Icon name="print"/>Print sheet</button>}</div>
      </form>}
    </>}
    </>}
  </Dialog>;
}
