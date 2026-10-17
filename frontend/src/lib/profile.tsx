import React from 'react';
import { Icon } from './ui';

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
