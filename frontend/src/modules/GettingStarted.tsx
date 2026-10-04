import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';

type Page = { total: number };
type Year = { id: string; name: string };
type Progress = { years: Year[]; classes: number; teachers: number; assignments: number; learners: number };
const levels = ['Nursery', 'KG', 'Primary', 'JHS'];

// Headteacher setup guide for a new school. Today's daily work appears only once classes exist.
export function GettingStarted({ schoolId, schoolName, csrfToken, children }: { schoolId: string; schoolName: string; csrfToken: string; children: React.ReactNode }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState({ name: '', startDate: '', endDate: '' });
  const [newClass, setNewClass] = useState({ name: '', level: 'Primary', capacity: '30' });
  const [added, setAdded] = useState<string[]>([]);
  const load = useCallback(async () => {
    try {
      const get = <T,>(path: string) => request<T>(`/schools/${schoolId}${path}`);
      const [years, classes, accounts, assignments, learners] = await Promise.all([
        get<{ items: Year[] }>('/academic-years?limit=100'), get<Page>('/classes?limit=1'),
        get<{ items: { role: string; revoked_at: string | null }[] }>('/accounts'),
        get<Page>('/teaching/assignments?limit=1'), get<Page>('/learners?limit=1')]);
      setProgress({ years: years.items, classes: classes.total, teachers: accounts.items.filter(a => a.role === 'teacher' && !a.revoked_at).length, assignments: assignments.total, learners: learners.total });
    } catch (e) { setError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void load(); }, [load]);
  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setError('');
    try { await request(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...body, operationId: crypto.randomUUID() }) }); await load(); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  const addYear = async (e: FormEvent) => { e.preventDefault(); if (await post('/academic-years', { name: year.name.trim(), startDate: year.startDate, endDate: year.endDate })) setYear({ name: '', startDate: '', endDate: '' }); };
  const addClass = async (e: FormEvent) => {
    e.preventDefault(); const name = newClass.name.trim();
    if (await post('/classes', { name, level: newClass.level, capacity: Number(newClass.capacity), academicYearId: progress!.years[0].id })) { setAdded(prior => [...prior, name]); setNewClass({ ...newClass, name: '' }); }
  };
  if (!progress) return error ? <section><p role="alert">{error}</p><button type="button" className="secondary" onClick={() => void load()}>Try again</button></section> : <p role="status">Loading…</p>;
  const steps = [
    { done: progress.years.length > 0, title: 'Add your academic year', why: 'Classes, terms and reports all belong to a school year.' },
    { done: progress.classes > 0, title: 'Create your classes', why: 'For example Nursery 1, KG 2, Primary 4 or JHS 1. Add every class you run.' },
    { done: progress.teachers > 0, title: 'Give your teachers a sign-in', why: 'Each teacher gets a temporary password to share with them privately.', href: '#/school', go: 'Open School → Staff and family accounts' },
    { done: progress.assignments > 0, title: 'Assign teachers to classes', why: 'A teacher only sees the classes you assign to them.', href: '#/learning', go: 'Open Learning → Assign a teacher' },
    { done: progress.learners > 0, title: 'Add your learners', why: 'Upload your class lists from Excel (CSV), or record learners one at a time.', href: '#/learners', go: 'Open Learners' },
  ];
  const doneCount = steps.filter(s => s.done).length, next = steps.findIndex(s => !s.done);
  if (next === -1) return <>{children}</>;
  return <>
    <section aria-labelledby="setup-title" className="setup">
      <p className="eyebrow">Getting started · {doneCount} of {steps.length} done</p>
      <h2 id="setup-title">Let's get {schoolName} ready</h2>
      <p className="muted">Follow these steps in order. Daily attendance, reports and fees start working once your classes and learners are in.</p>
      {error && <p role="alert">{error}</p>}
      <ol className="steps">{steps.map((s, i) => <li key={s.title} className={s.done ? 'done' : i === next ? 'current' : ''} aria-current={i === next ? 'step' : undefined}>
        <strong>{s.done ? '✓ ' : ''}{s.title}</strong>
        {!s.done && <span className="muted">{s.why}</span>}
        {i === next && i === 0 && <form onSubmit={addYear}>
          <label>Year name<input value={year.name} onChange={e => setYear({ ...year, name: e.target.value })} required maxLength={80} placeholder="2026/2027"/></label>
          <div className="grid"><label>First day of the year<input type="date" value={year.startDate} onChange={e => setYear({ ...year, startDate: e.target.value })} required/></label>
          <label>Day after the last day<input type="date" value={year.endDate} onChange={e => setYear({ ...year, endDate: e.target.value })} required/></label></div>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save academic year'}</button>
        </form>}
        {i === 1 && (i === next || added.length > 0) && <form onSubmit={addClass}>
          <p className="muted">Adding classes to {progress.years[0].name}.</p>
          <div className="grid"><label>Class name<input value={newClass.name} onChange={e => setNewClass({ ...newClass, name: e.target.value })} required maxLength={80} placeholder="Primary 1"/></label>
          <label>Level<select value={newClass.level} onChange={e => setNewClass({ ...newClass, level: e.target.value })}>{levels.map(l => <option key={l}>{l}</option>)}</select></label>
          <label>Maximum learners<input type="number" min={1} value={newClass.capacity} onChange={e => setNewClass({ ...newClass, capacity: e.target.value })} required/></label></div>
          <button disabled={busy}>{busy ? 'Saving…' : 'Add class'}</button>
          {added.length > 0 && <p role="status">Added: {added.join(', ')}. Add the next class, or move on to step 3.</p>}
        </form>}
        {i === next && s.href && <a className="button" href={s.href}>{s.go}</a>}
        {i === next && i > 1 && <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>I've done this, check again</button>}
      </li>)}</ol>
    </section>
    {progress.classes > 0 && children}
  </>;
}
