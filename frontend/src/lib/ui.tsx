import React, { useEffect, useRef } from 'react';

// Shared page building blocks, matching the client demo's layout: a page header with its actions,
// stat cards, cards with a title row, status pills, segmented tabs and a modal dialog.

export function PageHeader({ eyebrow, title, blurb, actions, id }: { eyebrow?: string; title: string; blurb?: string; actions?: React.ReactNode; id?: string }) {
  return <header className="page-header">
    <div className="page-header-text">
      {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
      <h2 id={id} className="page-heading">{title}</h2>
      {blurb && <p className="page-blurb">{blurb}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function Card({ title, hint, action, children, className = '', flush = false }: { title?: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return <div className={`card ${className}`}>
    {title && <div className="card-head"><div><h3>{title}</h3>{hint && <p className="card-hint">{hint}</p>}</div>{action}</div>}
    <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
  </div>;
}

export type Tone = 'positive' | 'caution' | 'critical' | 'info' | 'neutral';

export function Stat({ label, value, caption, tone = 'neutral', icon }: { label: string; value: React.ReactNode; caption?: React.ReactNode; tone?: Tone; icon?: string }) {
  return <div className="stat">
    <div className="stat-top"><span className="stat-label">{label}</span>{icon && <span className={`stat-icon tone-${tone}`}><Icon name={icon}/></span>}</div>
    <strong className={`stat-value tone-${tone}`}>{value}</strong>
    {caption && <span className="stat-caption">{caption}</span>}
  </div>;
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export const Icon = ({ name }: { name: string }) => <span className="icon" aria-hidden="true">{name}</span>;

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: { id: T; label: string }[]; label: string }) {
  return <div className="segmented" role="tablist" aria-label={label}>
    {options.map(option => <button key={option.id} type="button" role="tab" aria-selected={option.id === value} onClick={() => onChange(option.id)}>{option.label}</button>)}
  </div>;
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name="inbox"/></span><p className="empty-title">{title}</p>{hint && <p className="muted">{hint}</p>}{children}</div>;
}

// Modal dialog: focus moves inside on open, Escape and the backdrop close it, focus returns afterwards.
export function Dialog({ title, onClose, children, wide = false, drawer = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; drawer?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.dialog-close)')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; opener?.focus?.(); };
  }, []);
  return <div className={drawer ? 'dialog-layer drawer' : 'dialog-layer'}>
    <div className="dialog-backdrop" onClick={() => close.current()}/>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={wide ? 'dialog wide' : 'dialog'}>
      <div className="dialog-head"><h3>{title}</h3><button type="button" className="icon-button dialog-close" aria-label="Close" onClick={() => close.current()}><Icon name="close"/></button></div>
      <div className="dialog-body">{children}</div>
    </div>
  </div>;
}

export const todayInAccra = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
// The term a page should open on: the one running today, else the latest one already started, else the first listed.
export function currentTerm<T extends { start_date?: string; end_date?: string }>(terms: T[]): T | undefined {
  const today = todayInAccra();
  return terms.find(t => t.start_date && t.end_date && t.start_date <= today && today <= t.end_date)
    ?? [...terms].filter(t => t.start_date && t.start_date <= today).sort((a, b) => b.start_date!.localeCompare(a.start_date!))[0]
    ?? terms[0];
}
