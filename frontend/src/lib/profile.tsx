import React, { FormEvent, useRef, useState } from 'react';
import { Dialog, Icon } from './ui';

// The building blocks of a person's page (a student or a staff member): a card with who they are, a summary list and quick
// actions down the side. Both pages lay them out the same way so staff find things in the same place.

// A round stand-in for a photo: the person's initials on a colour that stays the same for the same name.
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]!.toUpperCase()).join('');
  let hue = 0; for (const letter of name) hue = (hue * 31 + letter.charCodeAt(0)) % 360;
  return <span className={`person-avatar person-avatar-${size}`} style={{ background: `hsl(${hue} 48% 34%)` }} aria-hidden="true">{initials}</span>;
}

export type Fact = { label: string; value: React.ReactNode; wide?: boolean };
// Name, what kind of person, a few status pills and the facts staff look up most.
export function ProfileCard({ name, kind, pills, facts, className = '' }: { name: string; kind: string; pills?: React.ReactNode; facts: Fact[]; className?: string }) {
  return <div className={`card person-card ${className}`}>
    <Avatar name={name} size="lg"/>
    <div className="profile-id"><h3>{name}</h3><p className="muted">{kind}</p>{pills && <div className="pill-row">{pills}</div>}</div>
    <dl className="profile-facts">{facts.map(f => <div key={f.label} className={f.wide ? 'wide' : undefined}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
  </div>;
}

export type SummaryRow = { icon: string; label: string; value: React.ReactNode };
export function SummaryCard({ title, rows }: { title: string; rows: SummaryRow[] }) {
  return <div className="card"><div className="card-head"><div><h3>{title}</h3></div></div>
    <div className="card-body"><dl className="summary-list">{rows.map(r => <div key={r.label}><dt><Icon name={r.icon}/>{r.label}</dt><dd>{r.value}</dd></div>)}</dl></div></div>;
}

export type QuickAction = { icon: string; label: string; onClick?: () => void; href?: string; disabled?: boolean; tone?: 'danger' };
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return <div className="card"><div className="card-head"><div><h3>Quick actions</h3></div></div>
    <div className="card-body"><ul className="profile-actions">{actions.map(a => <li key={a.label}>{a.href
      ? <a className="profile-action" href={a.href}><Icon name={a.icon}/>{a.label}</a>
      : <button type="button" className={`profile-action${a.tone === 'danger' ? ' danger' : ''}`} disabled={a.disabled} onClick={a.onClick}><Icon name={a.icon}/>{a.label}</button>}</li>)}</ul></div></div>;
}

// A detail that may be missing. The head sees "Not recorded" so a gap is easy to spot; everyone else just does not see the row.
export const notRecorded = <span className="not-recorded">Not recorded</span>;

export type DetailField = { key: string; label: string; kind?: 'text' | 'textarea' | 'select' | 'date' | 'tel'; options?: string[]; maxLength?: number; placeholder?: string; wide?: boolean };
export type DetailGroup = { title: string; note?: string; fields: DetailField[] };
// The form for a person's optional details. Every field may stay empty, and an empty field clears what was there. The save keeps
// one operation ID per payload, so a retry after a lost answer is applied once.
export function DetailsDialog({ title, intro, groups, values, onSave, onClose }: { title: string; intro?: string; groups: DetailGroup[]; values: Record<string, string | null | undefined>;
  onSave: (values: Record<string, string>, operationId: string) => Promise<void>; onClose: () => void }) {
  const fields = groups.flatMap(g => g.fields);
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, values[f.key] ?? ''])));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const operation = useRef<{ payload: string; id: string } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const payload = Object.fromEntries(fields.map(f => [f.key, (form[f.key] ?? '').trim()]));
    const serialized = JSON.stringify(payload);
    if (operation.current?.payload !== serialized) operation.current = { payload: serialized, id: crypto.randomUUID() };
    try { await onSave(payload, operation.current.id); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const input = (f: DetailField) => {
    const common = { value: form[f.key] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [f.key]: e.target.value }) };
    if (f.kind === 'select') return <select {...common}><option value="">Not recorded</option>{f.options!.map(o => <option key={o} value={o}>{o}</option>)}</select>;
    if (f.kind === 'textarea') return <textarea {...common} rows={3} maxLength={f.maxLength} placeholder={f.placeholder}/>;
    return <input {...common} type={f.kind === 'date' ? 'date' : f.kind === 'tel' ? 'tel' : 'text'} inputMode={f.kind === 'tel' ? 'tel' : undefined} maxLength={f.maxLength} placeholder={f.placeholder}/>;
  };
  return <Dialog title={title} wide onClose={onClose}>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={submit}>
      {intro && <p className="muted">{intro}</p>}
      {groups.map(g => <fieldset key={g.title} className="details-group"><legend>{g.title}</legend>{g.note && <p className="muted">{g.note}</p>}
        <div className="details-grid">{g.fields.map(f => <label key={f.key} className={f.wide ? 'wide' : undefined}>{f.label}{input(f)}</label>)}</div></fieldset>)}
      <div className="actions"><button disabled={busy}>Save details</button><button type="button" className="secondary" onClick={onClose}>Cancel</button></div>
    </form>
  </Dialog>;
}
