import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, PageHeader, Pill, Tabs, Tone, when } from '../lib/ui';

// The shared content library: the curriculum catalogue and the questions and parent guides written once for every school.
// Authors write, reviewers decide on other people's work, leads also keep the catalogue. Nothing here is shown to a family yet.
type Role = 'author' | 'reviewer' | 'lead';
type Page<T> = { items: T[]; total: number };
type Indicator = { id: string; subject: string; level: string; code: string | null; strand: string | null; subStrand: string | null; description: string; termGuidance: number[] | null; origin: 'official' | 'platform'; sourceNote: string; retiredAt: string | null; retirementReason: string | null; publishedQuestions: number; publishedGuides: number };
type QBody = { kind: 'choice' | 'number'; prompt: string; options: string[] | null; correctOption: number | null; answer: number | null; explanation: string | null };
type GBody = { learning: string; example: string; mistakes: string[]; activity: string };
type Finding = { code: string; message: string; blocking: boolean };
type Report = { blocking: number; warnings: number; machineChecked: boolean; findings: Finding[] };
type Status = 'draft' | 'in_review' | 'published' | 'rejected' | 'retired';
type Version = { id: string; itemId: string; version: number; status: Status; body: QBody | GBody; checks: Report | null; authorKind: string; authorId: string; authorName: string; submittedAt: string | null; reviewerName: string | null; reviewedAt: string | null; reviewNote: string | null; publishedAt: string | null; retiredAt: string | null; retiredByName: string | null; retirementReason: string | null };
type Row = { id: string; kind: 'question' | 'guide'; level: number | null; indicatorId: string; subject: string; classLevel: string; code: string | null; indicator: string; versionId: string; version: number; status: Status; authorName: string; lead: string; publishedVersion: number | null; updatedAt: string };
type Detail = { id: string; kind: 'question' | 'guide'; level: number | null; indicatorId: string; subject: string; classLevel: string; code: string | null; indicator: string; indicatorRetired: boolean; stage: string; versions: Version[] };
type Queued = Version & { kind: 'question' | 'guide'; level: number | null; subject: string; classLevel: string; code: string | null; indicator: string; stage: string };
type Me = { userId: string; roles: Role[]; queue: number };
type Props = { csrfToken: string };

const LEVELS = ['Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'JHS 1', 'JHS 2', 'JHS 3'];
const STATUS: Record<Status, { label: string; tone: Tone }> = { draft: { label: 'Draft', tone: 'neutral' }, in_review: { label: 'In review', tone: 'info' }, published: { label: 'Published', tone: 'positive' }, rejected: { label: 'Rejected', tone: 'critical' }, retired: { label: 'Retired', tone: 'caution' } };
const STAGE: Record<string, string> = { lower_primary: 'Lower Primary', upper_primary: 'Upper Primary', jhs: 'JHS' };
const levelName = (level: number | null) => level === 1 ? 'Level 1 · easiest' : level === 2 ? 'Level 2 · middle' : level === 3 ? 'Level 3 · hardest' : '';
const topic = (r: { code: string | null; subject: string; classLevel: string; indicator: string }) => `${r.classLevel} ${r.subject}${r.code ? ` · ${r.code}` : ''}: ${r.indicator}`;

// ---- Forms and what the server stores
type QForm = { kind: 'choice' | 'number'; level: number; prompt: string; options: string[]; correct: number; answer: string; explanation: string };
type GForm = { learning: string; example: string; mistakes: string; activity: string };
const blankQ = (): QForm => ({ kind: 'choice', level: 1, prompt: '', options: ['', '', '', ''], correct: 0, answer: '', explanation: '' });
const blankG = (): GForm => ({ learning: '', example: '', mistakes: '', activity: '' });
const qFrom = (b: QBody, level: number): QForm => ({ kind: b.kind, level, prompt: b.prompt, options: [...(b.options ?? []), '', '', '', ''].slice(0, 4), correct: b.correctOption ?? 0, answer: b.answer === null ? '' : String(b.answer), explanation: b.explanation ?? '' });
const gFrom = (b: GBody): GForm => ({ learning: b.learning, example: b.example, mistakes: b.mistakes.join('\n'), activity: b.activity });
function qBody(f: QForm) {
  const base = { kind: f.kind, prompt: f.prompt.trim(), ...(f.explanation.trim() ? { explanation: f.explanation.trim() } : {}) };
  if (f.kind === 'number') return { ...base, answer: Number(f.answer.trim()) };
  const kept = f.options.map((text, i) => ({ text: text.trim(), i })).filter(o => o.text);
  return { ...base, options: kept.map(o => o.text), correctOption: kept.findIndex(o => o.i === f.correct) };
}
const gBody = (f: GForm) => ({ learning: f.learning.trim(), example: f.example.trim(), mistakes: f.mistakes.split('\n').map(m => m.trim()).filter(Boolean), activity: f.activity.trim() });

// ---- Previews: what a child (or parent) will read, with the answer marked for the reviewer
function QuestionView({ body }: { body: QBody }) {
  return <>
    <strong className="q-prompt">{body.prompt}</strong>
    {body.kind === 'choice' ? <ul className="q-options">{body.options!.map((o, j) => <li key={j} className={j === body.correctOption ? 'right' : ''}><Icon name={j === body.correctOption ? 'check_circle' : 'radio_button_unchecked'}/><span>{o}{j === body.correctOption && <span className="sr-only"> (correct)</span>}</span></li>)}</ul> : <span className="q-number">Number answer: <strong>{body.answer}</strong></span>}
    {body.explanation && <span className="sub q-why">Why: {body.explanation}</span>}
  </>;
}
function GuideView({ body }: { body: GBody }) {
  return <div className="guide">
    <p><strong>What your child is learning.</strong> {body.learning}</p>
    <p><strong>Worked example.</strong> {body.example}</p>
    <p><strong>Common mistakes.</strong></p><ul>{body.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul>
    <p><strong>Try at home.</strong> {body.activity}</p>
  </div>;
}
const Preview = ({ kind, body }: { kind: 'question' | 'guide'; body: QBody | GBody }) => kind === 'question' ? <div className="q-preview"><QuestionView body={body as QBody}/></div> : <GuideView body={body as GBody}/>;
function Findings({ report, kind }: { report: Report | null; kind: 'question' | 'guide' }) {
  if (!report) return null;
  return <div className="findings">
    {kind === 'question' && !report.findings.some(f => f.code === 'wrong_answer' || f.code === 'two_right_answers') && <p>{report.machineChecked ? <Pill tone="positive">Answer worked out by the computer: it matches</Pill> : <Pill tone="neutral">Not a plain sum: check the answer yourself</Pill>}</p>}
    {report.findings.map((f, i) => <p key={i}><Pill tone={f.blocking ? 'critical' : 'caution'}>{f.blocking ? 'Fix' : 'Look'}</Pill> {f.message}</p>)}
    {!report.findings.length && <p className="muted">The automatic checks found nothing to flag.</p>}
  </div>;
}

// A reason or note on one screen, instead of a browser prompt.
function ReasonDialog({ title, label, confirm, required, onSubmit, onClose }: { title: string; label: string; confirm: string; required: boolean; onSubmit: (text: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await onSubmit(text.trim()); } catch (e) { setError((e as Error).message); setBusy(false); } }
  return <Dialog title={title} onClose={onClose}><form onSubmit={submit}>
    {error && <p role="alert">{error}</p>}
    <label>{label}<textarea rows={3} maxLength={500} value={text} onChange={e => setText(e.target.value)} required={required} minLength={required ? 3 : undefined}/></label>
    <div className="actions"><button disabled={busy || (required && text.trim().length < 3)}>{busy ? 'Saving…' : confirm}</button><button type="button" className="secondary" onClick={onClose}>Cancel</button></div>
  </form></Dialog>;
}

type Target = { kind: 'question' | 'guide'; indicatorId: string; heading: string; version?: Version; level?: number; itemId?: string; body?: QBody | GBody };
function Editor({ target, send, put, onClose, onDone }: { target: Target; send: <T>(path: string, body?: object) => Promise<T>; put: (path: string, body: object) => Promise<unknown>; onClose: () => void; onDone: (message: string) => void }) {
  const [q, setQ] = useState<QForm>(() => target.kind === 'question' ? (target.body ? qFrom(target.body as QBody, target.level ?? 1) : { ...blankQ(), level: target.level ?? 1 }) : blankQ());
  const [g, setG] = useState<GForm>(() => target.kind === 'guide' && target.body ? gFrom(target.body as GBody) : blankG());
  const [saved, setSaved] = useState<string | null>(target.version?.id ?? null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [report, setReport] = useState<Report | null>(null);
  const complete = target.kind === 'guide' ? g.learning.trim().length >= 20 && g.example.trim().length >= 10 && gBody(g).mistakes.length >= 1 && g.activity.trim().length >= 10
    : q.prompt.trim().length >= 5 && (q.kind === 'number' ? q.answer.trim() !== '' && Number.isFinite(Number(q.answer)) : q.options.filter(o => o.trim()).length >= 3 && q.options[q.correct]?.trim() !== '');
  async function save(andSubmit: boolean) {
    setBusy(true); setError(''); setReport(null);
    try {
      const body = target.kind === 'guide' ? gBody(g) : qBody(q);
      let versionId = saved;
      if (versionId) await put(`/versions/${versionId}`, { body });
      else if (target.itemId) versionId = (await send<{ versionId: string }>(`/items/${target.itemId}/versions`, { body })).versionId;
      else versionId = (await send<{ versionId: string }>('/items', { kind: target.kind, indicatorId: target.indicatorId, ...(target.kind === 'question' ? { level: q.level } : {}), body })).versionId;
      setSaved(versionId);
      if (!andSubmit) return onDone('Draft saved. Submit it for review when it is ready.');
      try { await send(`/versions/${versionId}/submit`); onDone('Submitted for review. A reviewer other than you will decide on it.'); }
      catch (e) {
        const found = (e as { code?: string; details?: Report }); if (found.code !== 'CHECKS_FAILED' || !found.details) throw e;
        setReport(found.details); setError('The draft is saved, but the automatic checks found something to fix before it can go to review.');
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog title={target.heading} onClose={onClose} wide><form onSubmit={(e: FormEvent) => { e.preventDefault(); void save(true); }} className="q-editor">
    {error && <p role="alert">{error}</p>}
    <Findings report={report} kind={target.kind}/>
    {target.kind === 'question' ? <div className="q-card">
      <div className="field-row">
        <label>Question<textarea rows={2} value={q.prompt} maxLength={200} onChange={e => setQ({ ...q, prompt: e.target.value })} required minLength={5}/></label>
        <label className="q-kind">Answer type<select value={q.kind} onChange={e => setQ({ ...q, kind: e.target.value as QForm['kind'] })}><option value="choice">Multiple choice</option><option value="number">A number</option></select></label>
        {!target.itemId && !saved && <label className="q-kind">Difficulty<select value={q.level} onChange={e => setQ({ ...q, level: Number(e.target.value) })}><option value={1}>Level 1 · easiest</option><option value={2}>Level 2 · middle</option><option value={3}>Level 3 · hardest</option></select></label>}
      </div>
      {q.kind === 'choice' ? <fieldset className="q-options-edit"><legend>Options: tick the correct one</legend>
        {q.options.map((o, j) => <label key={j} className="q-option"><input type="radio" name="right" checked={q.correct === j} onChange={() => setQ({ ...q, correct: j })} aria-label={`Option ${j + 1} is correct`}/>
          <input value={o} maxLength={80} placeholder={j < 3 ? `Option ${j + 1}` : 'Option 4 (optional)'} onChange={e => setQ({ ...q, options: q.options.map((x, k) => k === j ? e.target.value : x) })} aria-label={`Option ${j + 1}`}/></label>)}</fieldset>
        : <label>Correct number (no units; say the unit in the question)<input inputMode="decimal" value={q.answer} onChange={e => setQ({ ...q, answer: e.target.value })} placeholder="e.g. 12.5"/></label>}
      <label>Why (shown after the child answers; optional)<input value={q.explanation} maxLength={200} onChange={e => setQ({ ...q, explanation: e.target.value })}/></label>
    </div> : <div className="q-card">
      <label>What your child is learning<textarea rows={3} maxLength={600} value={g.learning} onChange={e => setG({ ...g, learning: e.target.value })} required minLength={20}/></label>
      <label>One worked example<textarea rows={3} maxLength={600} value={g.example} onChange={e => setG({ ...g, example: e.target.value })} required minLength={10}/></label>
      <label>Common mistakes (one per line, up to 4)<textarea rows={3} value={g.mistakes} onChange={e => setG({ ...g, mistakes: e.target.value })} required/></label>
      <label>A 5-minute activity with things in the house<textarea rows={3} maxLength={400} value={g.activity} onChange={e => setG({ ...g, activity: e.target.value })} required minLength={10}/></label>
    </div>}
    <div className="actions">
      <button disabled={busy || !complete}>{busy ? 'Saving…' : 'Save and submit for review'}</button>
      <button type="button" className="secondary" disabled={busy || !complete} onClick={() => void save(false)}>Save draft</button>
      <button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button>
    </div>
  </form></Dialog>;
}

type Act = { send: <T>(path: string, body?: object) => Promise<T>; notify: (message: string) => void; roles: Role[]; userId: string };

// Approve or reject: the reviewer's decision on someone else's version.
function ReviewButtons({ v, act, after }: { v: Version; act: Act; after: () => void }) {
  const [ask, setAsk] = useState<'approve' | 'reject' | null>(null);
  return <>
    <div className="actions">
      <button type="button" onClick={() => setAsk('approve')}><Icon name="check"/>Approve and publish</button>
      <button type="button" className="secondary" onClick={() => setAsk('reject')}>Reject</button>
    </div>
    {ask === 'approve' && <ReasonDialog title="Approve and publish" label="Note (optional): what you checked" confirm="Approve and publish" required={false} onClose={() => setAsk(null)} onSubmit={async note => { await act.send(`/versions/${v.id}/approve`, note ? { note } : {}); setAsk(null); act.notify('Published. It is now live in the library.'); after(); }}/>}
    {ask === 'reject' && <ReasonDialog title="Reject this version" label="Why is it being rejected? The author sees this." confirm="Reject" required onClose={() => setAsk(null)} onSubmit={async note => { await act.send(`/versions/${v.id}/reject`, { note }); setAsk(null); act.notify('Rejected. The author can write a new version.'); after(); }}/>}
  </>;
}

function ItemDrawer({ itemId, act, onClose, onChanged, openEditor }: { itemId: string; act: Act; onClose: () => void; onChanged: () => void; openEditor: (t: Target) => void }) {
  const [item, setItem] = useState<Detail | null>(null); const [error, setError] = useState(''); const [ask, setAsk] = useState<{ title: string; label: string; confirm: string; path: string } | null>(null);
  const load = useCallback(() => request<Detail>(`/content/items/${itemId}`).then(setItem).catch(e => setError((e as Error).message)), [itemId]);
  useEffect(() => { void load(); }, [load]);
  const canWrite = act.roles.includes('author') || act.roles.includes('lead'), canReview = act.roles.includes('reviewer') || act.roles.includes('lead');
  const changed = () => { void load(); onChanged(); };
  async function submit(v: Version) { try { await act.send(`/versions/${v.id}/submit`); changed(); } catch (e) { const found = e as { code?: string; details?: Report; message: string }; setError(found.code === 'CHECKS_FAILED' ? `${found.message}: ${(found.details?.findings ?? []).filter(f => f.blocking).map(f => f.message).join('; ')}` : found.message); } }
  return <Dialog title={item ? `${item.kind === 'question' ? 'Question' : 'Parent guide'} · ${item.classLevel} ${item.subject}` : 'Content item'} onClose={onClose} drawer wide>
    {error && <p role="alert">{error}</p>}
    {item && <>
      <p className="muted">{topic(item)}<br/>{STAGE[item.stage]}{item.level ? ` · ${levelName(item.level)}` : ''}</p>
      {item.versions.map((v, index) => <Card key={v.id} title={`Version ${v.version}`} action={<Pill tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Pill>}>
        <Preview kind={item.kind} body={v.body}/>
        <p className="muted">{v.authorKind === 'ai' ? 'Drafted with Claude, asked for by' : 'Written by'} {v.authorName}{v.submittedAt ? ` · submitted ${when(v.submittedAt)}` : ''}</p>
        {v.reviewerName && <p className="muted">{v.status === 'rejected' ? 'Rejected' : 'Approved'} by {v.reviewerName}, {when(v.reviewedAt)}{v.reviewNote ? `: ${v.reviewNote}` : ''}</p>}
        {v.retiredAt && <p className="muted">Out of use since {when(v.retiredAt)} ({v.retiredByName}): {v.retirementReason}</p>}
        {v.status !== 'draft' && <Findings report={v.checks} kind={item.kind}/>}
        <div className="actions">
          {v.status === 'draft' && v.authorId === act.userId && <>
            <button type="button" className="small" onClick={() => openEditor({ kind: item.kind, indicatorId: item.indicatorId, heading: `Edit draft · version ${v.version}`, version: v, body: v.body, ...(item.level ? { level: item.level } : {}), itemId: item.id })}>Edit</button>
            <button type="button" className="small" onClick={() => void submit(v)}>Submit for review</button>
            <button type="button" className="secondary small" onClick={() => setAsk({ title: 'Withdraw this draft', label: 'Why are you withdrawing it?', confirm: 'Withdraw', path: `/versions/${v.id}/retire` })}>Withdraw</button></>}
          {(v.status === 'published' || v.status === 'in_review') && canReview && <button type="button" className="secondary small" onClick={() => setAsk({ title: 'Take this version out of use', label: 'Why is it being taken out of use? Nothing new is served from it.', confirm: 'Take out of use', path: `/versions/${v.id}/retire` })}>Take out of use</button>}
          {index === 0 && ['published', 'rejected', 'retired'].includes(v.status) && canWrite && !item.indicatorRetired && <button type="button" className="small" onClick={() => openEditor({ kind: item.kind, indicatorId: item.indicatorId, heading: `New version of this ${item.kind}`, body: v.body, ...(item.level ? { level: item.level } : {}), itemId: item.id })}>Write a new version</button>}
        </div>
        {v.status === 'in_review' && canReview && v.authorId !== act.userId && <ReviewButtons v={v} act={act} after={changed}/>}
      </Card>)}
    </>}
    {ask && <ReasonDialog {...ask} required onClose={() => setAsk(null)} onSubmit={async reason => { await act.send(ask.path, { reason }); setAsk(null); changed(); }}/>}
  </Dialog>;
}

function CatalogueForm({ send, onClose, onDone }: { send: Act['send']; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ subject: '', level: 'Basic 4', code: '', strand: '', subStrand: '', description: '', terms: [] as number[], origin: 'platform', sourceNote: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (change: Partial<typeof f>) => setF(prior => ({ ...prior, ...change }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await send('/catalogue', { subject: f.subject.trim(), level: f.level, description: f.description.trim(), origin: f.origin, sourceNote: f.sourceNote.trim(), ...(f.code.trim() ? { code: f.code.trim() } : {}), ...(f.strand.trim() ? { strand: f.strand.trim() } : {}), ...(f.subStrand.trim() ? { subStrand: f.subStrand.trim() } : {}), ...(f.terms.length ? { termGuidance: f.terms } : {}) });
      onDone('Added to the catalogue.');
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Dialog title="Add a catalogue entry" onClose={onClose} wide><form onSubmit={submit}>
    {error && <p role="alert">{error}</p>}
    <div className="field-row"><label>Subject<input value={f.subject} onChange={e => set({ subject: e.target.value })} required minLength={2} maxLength={60} placeholder="Mathematics"/></label><label>Class level<select value={f.level} onChange={e => set({ level: e.target.value })}>{LEVELS.map(l => <option key={l}>{l}</option>)}</select></label><label>Code (optional)<input value={f.code} onChange={e => set({ code: e.target.value })} maxLength={40}/></label></div>
    <div className="field-row"><label>Strand (optional)<input value={f.strand} onChange={e => set({ strand: e.target.value })} maxLength={120}/></label><label>Sub-strand (optional)<input value={f.subStrand} onChange={e => set({ subStrand: e.target.value })} maxLength={120}/></label></div>
    <label>Indicator: what the child can do<textarea rows={2} value={f.description} onChange={e => set({ description: e.target.value })} required minLength={3} maxLength={400}/></label>
    <fieldset><legend>Usually taught in term (optional)</legend><div className="actions">{[1, 2, 3].map(t => <label key={t} className="check"><input type="checkbox" checked={f.terms.includes(t)} onChange={e => set({ terms: e.target.checked ? [...f.terms, t] : f.terms.filter(x => x !== t) })}/><span>Term {t}</span></label>)}</div></fieldset>
    <div className="field-row"><label>Where it comes from<select value={f.origin} onChange={e => set({ origin: e.target.value })}><option value="platform">Written by the platform team</option><option value="official">Taken from a published curriculum</option></select></label>
      <label>Source note (name the document, or say who wrote it)<input value={f.sourceNote} onChange={e => set({ sourceNote: e.target.value })} required minLength={3} maxLength={300}/></label></div>
    <p className="muted">Wording is kept as entered. To correct an entry, retire it and add the corrected one. Do not copy curriculum text you do not have the right to use.</p>
    <div className="actions"><button disabled={busy}>{busy ? 'Adding…' : 'Add to catalogue'}</button><button type="button" className="secondary" onClick={onClose}>Cancel</button></div>
  </form></Dialog>;
}

export function ContentLibrary({ csrfToken }: Props) {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<'library' | 'review' | 'catalogue'>('library');
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [editor, setEditor] = useState<Target | null>(null); const [open, setOpen] = useState(''); const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const send = useCallback(<T,>(path: string, body: object = {}) => request<T>(`/content${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) }), [csrfToken]);
  const put = useCallback((path: string, body: object) => request(`/content${path}`, { method: 'PUT', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify(body) }), [csrfToken]);
  const refresh = useCallback(() => { setVersion(v => v + 1); request<Me>('/content/me').then(setMe).catch(() => undefined); }, []);
  useEffect(() => { request<Me>('/content/me').then(m => { setMe(m); setTab(m.roles.includes('reviewer') || m.roles.includes('lead') ? (m.queue ? 'review' : 'library') : 'library'); }).catch(e => setError((e as Error).message)); }, []);
  const notify = useCallback((text: string) => { setMessage(text); setError(''); refresh(); }, [refresh]);
  if (!me) return <section aria-label="Content library">{error ? <p role="alert">{error}</p> : <p role="status">Loading the content library…</p>}</section>;
  const act: Act = { send, notify, roles: me.roles, userId: me.userId };
  const canWrite = me.roles.includes('author') || me.roles.includes('lead'), canReview = me.roles.includes('reviewer') || me.roles.includes('lead'), lead = me.roles.includes('lead');
  const tabs = [{ id: 'library' as const, label: 'Library' }, ...(canReview ? [{ id: 'review' as const, label: me.queue ? `Review (${me.queue})` : 'Review' }] : []), { id: 'catalogue' as const, label: 'Catalogue' }];
  const done = (text: string) => { setEditor(null); setMessage(text); setError(''); refresh(); };
  return <section aria-label="Content library">
    <PageHeader eyebrow="Home Learning Pass" title="Content library" blurb="Questions and parent guides written once and reviewed centrally. A published item always has a named reviewer who did not write it."
      actions={lead && tab === 'catalogue' ? <button type="button" onClick={() => setAdding(true)}><Icon name="add"/>Add catalogue entry</button> : undefined}/>
    <p className="muted">You are {me.roles.map(r => r === 'lead' ? 'a content lead' : `a content ${r}`).join(' and ')}.</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <div className="actions"><Tabs label="Content library" value={tab} onChange={t => { setTab(t); setMessage(''); }} options={tabs}/></div>
    {tab === 'library' && <LibraryTab refreshed={version} canWrite={canWrite} onOpen={setOpen}/>}
    {tab === 'review' && canReview && <ReviewTab key={version} act={act} onOpen={setOpen}/>}
    {tab === 'catalogue' && <CatalogueTab refreshed={version} lead={lead} canWrite={canWrite} act={act} onWrite={setEditor} onOpen={setOpen}/>}
    {editor && <Editor target={editor} send={send} put={put} onClose={() => setEditor(null)} onDone={done}/>}
    {open && <ItemDrawer itemId={open} act={act} onClose={() => setOpen('')} onChanged={refresh} openEditor={t => { setOpen(''); setEditor(t); }}/>}
    {adding && <CatalogueForm send={send} onClose={() => setAdding(false)} onDone={text => { setAdding(false); done(text); }}/>}
  </section>;
}

function LibraryTab({ refreshed, canWrite, onOpen }: { refreshed: number; canWrite: boolean; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null); const [total, setTotal] = useState(0); const [error, setError] = useState('');
  const [kind, setKind] = useState(''); const [status, setStatus] = useState(''); const [mine, setMine] = useState(false);
  const query = (offset: number) => `/content/items?limit=50&offset=${offset}${kind ? `&kind=${kind}` : ''}${status ? `&status=${status}` : ''}${mine ? '&mine=true' : ''}`;
  // A change elsewhere (refreshed) reloads the list in place, keeping the filters.
  useEffect(() => { request<Page<Row>>(query(0)).then(p => { setRows(p.items); setTotal(p.total); }).catch(e => setError((e as Error).message)); }, [kind, status, mine, refreshed]);
  return <Card flush>
    <div className="toolbar">
      <label>Kind<select value={kind} onChange={e => setKind(e.target.value)}><option value="">All</option><option value="question">Questions</option><option value="guide">Parent guides</option></select></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Any</option>{(Object.keys(STATUS) as Status[]).map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}</select></label>
      {canWrite && <label className="check"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/><span>Written by me</span></label>}
      <span className="count">{rows ? `${total} ${total === 1 ? 'item' : 'items'}` : ''}</span>
    </div>
    {error && <p role="alert">{error}</p>}
    {rows === null ? <p role="status" className="pad">Loading…</p> : !rows.length ? <Empty title="Nothing here yet" hint={canWrite ? 'Open the Catalogue, choose an indicator and write its first question or guide.' : 'Items appear here as authors write them.'}/> :
      <ul className="entries">{rows.map(r => <li key={r.id}>
        <div className="entry-main"><button type="button" className="link-button" onClick={() => onOpen(r.id)}>{r.lead}</button>
          <span className="muted">{r.kind === 'question' ? levelName(r.level) : 'Parent guide'} · {r.classLevel} {r.subject}{r.code ? ` · ${r.code}` : ''}</span></div>
        <div className="entry-side"><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill><span className="muted">v{r.version}{r.publishedVersion && r.publishedVersion !== r.version ? ` · v${r.publishedVersion} live` : ''} · {r.authorName} · {when(r.updatedAt)}</span></div></li>)}</ul>}
    {rows && rows.length < total && <p className="pad"><button type="button" className="secondary" onClick={() => request<Page<Row>>(query(rows.length)).then(p => setRows([...rows, ...p.items])).catch(e => setError((e as Error).message))}>Show more</button></p>}
  </Card>;
}

function ReviewTab({ act, onOpen }: { act: Act; onOpen: (id: string) => void }) {
  const [queue, setQueue] = useState<Queued[] | null>(null); const [error, setError] = useState('');
  useEffect(() => { request<{ items: Queued[] }>('/content/queue').then(q => setQueue(q.items)).catch(e => setError((e as Error).message)); }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!queue) return <p role="status">Loading…</p>;
  if (!queue.length) return <Empty title="Nothing is waiting for review" hint="Work other people have submitted appears here. You cannot review your own writing."/>;
  return <>{queue.map(v => <Card key={v.id} title={topic(v)} hint={`${v.kind === 'question' ? `Question · ${levelName(v.level)}` : 'Parent guide'} · ${STAGE[v.stage]} · written by ${v.authorName}, submitted ${when(v.submittedAt)}`}
    action={<button type="button" className="link-button" onClick={() => onOpen(v.itemId)}>All versions</button>}>
    <Preview kind={v.kind} body={v.body}/>
    <Findings report={v.checks} kind={v.kind}/>
    <ReviewButtons v={v} act={act} after={() => undefined}/>
  </Card>)}</>;
}

function CatalogueTab({ refreshed, lead, canWrite, act, onWrite, onOpen }: { refreshed: number; lead: boolean; canWrite: boolean; act: Act; onWrite: (t: Target) => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Indicator[] | null>(null); const [total, setTotal] = useState(0); const [error, setError] = useState('');
  const [level, setLevel] = useState(''); const [search, setSearch] = useState(''); const [retired, setRetired] = useState(false);
  const [chosen, setChosen] = useState<Indicator | null>(null); const [retiring, setRetiring] = useState<Indicator | null>(null);
  const query = (offset: number) => `/content/catalogue?limit=100&offset=${offset}${level ? `&level=${encodeURIComponent(level)}` : ''}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}${retired ? '&includeRetired=true' : ''}`;
  useEffect(() => { const timer = setTimeout(() => request<Page<Indicator>>(query(0)).then(p => { setRows(p.items); setTotal(p.total); }).catch(e => setError((e as Error).message)), search ? 250 : 0); return () => clearTimeout(timer); }, [level, search, retired, refreshed]);
  return <>
    <Card flush>
      <div className="toolbar">
        <label>Class<select value={level} onChange={e => setLevel(e.target.value)}><option value="">All levels</option>{LEVELS.map(l => <option key={l}>{l}</option>)}</select></label>
        <div className="search"><Icon name="search"/><input type="search" placeholder="Search indicators or codes" aria-label="Search the catalogue" value={search} onChange={e => setSearch(e.target.value)}/></div>
        <label className="check"><input type="checkbox" checked={retired} onChange={e => setRetired(e.target.checked)}/><span>Show retired</span></label>
        <span className="count">{rows ? `${total} ${total === 1 ? 'entry' : 'entries'}` : ''}</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {rows === null ? <p role="status" className="pad">Loading…</p> : !rows.length ? <Empty title="The catalogue is empty" hint={lead ? 'Add the first entry: an indicator for a subject and class, with where it comes from.' : 'A content lead adds catalogue entries.'}/> :
        <ul className="entries">{rows.map(r => <li key={r.id}>
          <div className="entry-main"><strong>{r.level} · {r.subject}{r.code ? ` · ${r.code}` : ''}</strong><span>{r.description}</span>
            <span className="muted">{r.origin === 'official' ? 'Published curriculum' : 'Written by the platform team'} · {r.sourceNote}{r.termGuidance ? ` · Term ${r.termGuidance.join(', ')}` : ''}</span>
            {r.retiredAt && <span><Pill tone="caution">Retired</Pill> <span className="muted">{r.retirementReason}</span></span>}</div>
          <div className="entry-side"><span>{r.publishedQuestions} {r.publishedQuestions === 1 ? 'question' : 'questions'} · {r.publishedGuides} {r.publishedGuides === 1 ? 'guide' : 'guides'}</span><button type="button" className="secondary" onClick={() => setChosen(r)}>Open</button></div></li>)}</ul>}
    </Card>
    {chosen && <Dialog title={`${chosen.level} ${chosen.subject}${chosen.code ? ` · ${chosen.code}` : ''}`} onClose={() => setChosen(null)} drawer wide>
      <p>{chosen.description}</p>
      <p className="muted">{chosen.strand}{chosen.subStrand ? ` › ${chosen.subStrand}` : ''}{chosen.strand || chosen.subStrand ? ' · ' : ''}{chosen.origin === 'official' ? 'Published curriculum' : 'Written by the platform team'}: {chosen.sourceNote}</p>
      <div className="actions">
        {canWrite && !chosen.retiredAt && <><button type="button" onClick={() => { onWrite({ kind: 'question', indicatorId: chosen.id, heading: `New question · ${chosen.level} ${chosen.subject}` }); setChosen(null); }}><Icon name="add"/>New question</button>
          <button type="button" className="secondary" onClick={() => { onWrite({ kind: 'guide', indicatorId: chosen.id, heading: `New parent guide · ${chosen.level} ${chosen.subject}` }); setChosen(null); }}>New parent guide</button></>}
        {lead && !chosen.retiredAt && <button type="button" className="secondary" onClick={() => { setRetiring(chosen); setChosen(null); }}>Retire this entry</button>}
      </div>
      <IndicatorItems indicatorId={chosen.id} onOpen={id => { setChosen(null); onOpen(id); }}/>
    </Dialog>}
    {retiring && <ReasonDialog title="Retire this catalogue entry" label="Why is it being retired? Its content stops being offered; nothing is deleted." confirm="Retire" required onClose={() => setRetiring(null)} onSubmit={async reason => { await act.send(`/catalogue/${retiring.id}/retire`, { reason }); setRetiring(null); act.notify('Retired.'); }}/>}
  </>;
}

function IndicatorItems({ indicatorId, onOpen }: { indicatorId: string; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { request<Page<Row>>(`/content/items?indicatorId=${indicatorId}&limit=100`).then(p => setRows(p.items)).catch(() => setRows([])); }, [indicatorId]);
  if (!rows) return <p role="status">Loading…</p>;
  if (!rows.length) return <p className="muted">No questions or guides yet for this indicator.</p>;
  return <ul className="history">{rows.map(r => <li key={r.id}><button type="button" className="link-button" onClick={() => onOpen(r.id)}>{r.lead}</button><span>{r.kind === 'question' ? levelName(r.level) : 'Parent guide'} · {STATUS[r.status].label} · v{r.version}</span></li>)}</ul>;
}
