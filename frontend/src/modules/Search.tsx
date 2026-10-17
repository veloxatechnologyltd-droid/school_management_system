import React, { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { findOn } from '../lib/find';
import { Dialog, Icon, Pill } from '../lib/ui';
import { cedis } from './Finance';

type Context = { yearName: string | null; term: { name: string; startDate: string; endDate: string; week: number } | null; nextTerm: { name: string; yearName: string; startDate: string } | null };
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// The year and term running today, beside the school name, so every page is read against the same term.
export function TermChip({ schoolId }: { schoolId: string }) {
  const [context, setContext] = useState<Context | null>(null);
  useEffect(() => { setContext(null); request<Context>(`/schools/${schoolId}/context`).then(setContext).catch(() => setContext(null)); }, [schoolId]);
  if (!context || (!context.term && !context.nextTerm && !context.yearName)) return null;
  const text = context.term ? `${context.term.name} · Week ${context.term.week}` : context.nextTerm ? `Holiday · ${context.nextTerm.name} starts ${shortDate(context.nextTerm.startDate)}` : 'No term running';
  const title = context.term ? `${context.yearName ?? ''} ${context.term.name}: ${shortDate(context.term.startDate)} to ${shortDate(context.term.endDate)}` : undefined;
  return <span className="term-chip" title={title}><Icon name="calendar_month"/>{context.yearName && <b>{context.yearName}</b>}<span>{text}</span></span>;
}

type Student = { id: string; full_name: string; admission_number: string; class_name: string | null };
type Parent = { name: string; children: string };
type Receipt = { id: string; receipt_number: number; amount_pesewas: number; received_on: string; full_name: string; reversed: boolean };
type Results = { students: Student[]; parents: Parent[]; receipts: Receipt[] };
type Hit = { key: string; icon: string; label: string; detail: string; go: () => void; reversed?: boolean };

const hint: Record<string, string> = { headteacher: 'Students, parents or a receipt number', accountant: 'Students or a receipt number', teacher: 'Your students by name or admission number', frontdesk: 'Students by name or admission number' };

// One search box for staff (Ctrl K or / opens it). Each result opens the page that holds it: a student's own page for the
// headteacher and teachers, the student's bill in Accounts for the accountant, the Students roll for the front desk.
export function GlobalSearch({ schoolId, role, onFind }: { schoolId: string; role: string; onFind: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setOpen(true); }
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, []);
  if (!hint[role]) return null;
  return <>
    <button type="button" className="search-trigger" onClick={() => setOpen(true)} aria-label="Search the school" aria-keyshortcuts="Control+K"><Icon name="search"/><span className="search-trigger-text">Search</span><kbd>Ctrl K</kbd></button>
    {open && <SearchDialog schoolId={schoolId} role={role} onClose={() => setOpen(false)} onFind={onFind}/>}
  </>;
}

function SearchDialog({ schoolId, role, onClose, onFind }: { schoolId: string; role: string; onClose: () => void; onFind: () => void }) {
  const [q, setQ] = useState(''); const [results, setResults] = useState<Results | null>(null); const [error, setError] = useState(''); const [active, setActive] = useState(0);
  const asked = useRef('');
  useEffect(() => {
    const text = q.trim(); setError('');
    if (text.length < 2) { setResults(null); return; }
    const timer = setTimeout(() => {
      asked.current = text;
      request<Results>(`/schools/${schoolId}/search?q=${encodeURIComponent(text)}`).then(r => { if (asked.current === text) { setResults(r); setActive(0); } }).catch(e => setError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, schoolId]);
  const go = (hash: string, find?: Parameters<typeof findOn>[0]) => () => { if (find) findOn(find); onFind(); onClose(); location.hash = hash; };
  // A receipt number is an exact match, so it comes before students whose admission numbers merely contain it.
  const hits: Hit[] = !results ? [] : [
    ...results.receipts.map(r => ({ key: `r:${r.id}`, icon: 'receipt_long', label: `Receipt no. ${r.receipt_number}`, detail: `${r.full_name} · ${cedis(r.amount_pesewas)} · ${shortDate(r.received_on)}`, reversed: r.reversed, go: go('#/accounts', { page: 'accounts', receiptId: r.id }) })),
    ...results.students.map(s => ({ key: `s:${s.id}`, icon: 'person', label: s.full_name, detail: `${s.admission_number} · ${s.class_name ?? 'Not in a class today'}`,
      go: role === 'headteacher' || role === 'teacher' ? go(`#/learner/${s.id}`) : role === 'accountant' ? go('#/accounts', { page: 'accounts', text: s.admission_number }) : go('#/students', { page: 'students', text: s.admission_number }) })),
    ...results.parents.map(p => ({ key: `p:${p.name}`, icon: 'family_restroom', label: p.name, detail: `Parent of ${p.children}`, go: go('#/parents', { page: 'parents', text: p.name }) })),
  ];
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setActive(i => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); setActive(i => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); hits[active].go(); }
  };
  return <Dialog title="Search" onClose={onClose}>
    <label className="search search-box"><span className="sr-only">Search</span><Icon name="search"/>
      <input type="search" autoFocus value={q} maxLength={80} onChange={e => setQ(e.target.value)} onKeyDown={keys} placeholder={hint[role]}
        role="combobox" aria-expanded={hits.length > 0} aria-controls="search-results" aria-activedescendant={hits[active] ? `hit-${active}` : undefined} aria-autocomplete="list"/></label>
    {error && <p role="alert">{error}</p>}
    {results && !hits.length && <p className="muted" role="status">Nothing found for “{q.trim()}”.</p>}
    {hits.length > 0 && <ul className="search-results" id="search-results" role="listbox" aria-label="Results">
      {hits.map((hit, i) => <li key={hit.key} id={`hit-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={hit.go}>
        <Icon name={hit.icon}/><span><strong>{hit.label}</strong><span className="sub">{hit.detail}</span></span>{hit.reversed && <Pill tone="critical">Reversed</Pill>}</li>)}
    </ul>}
    {results && (results.students.length === 6 || results.parents.length === 6) && <p className="muted">Showing the first six of each. Type more of the name to narrow it down.</p>}
    {!results && <p className="muted">Type at least two letters. {role === 'headteacher' || role === 'accountant' ? 'A number finds that receipt.' : ''}</p>}
  </Dialog>;
}
