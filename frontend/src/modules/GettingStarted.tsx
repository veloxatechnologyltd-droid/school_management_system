import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Icon, PageHeader, Stat } from '../lib/ui';

type Page = { total: number };
type Year = { id: string; name: string };
type Progress = { years: Year[]; classes: number; teachers: number; assignments: number; learners: number };
const levels = ['Nursery', 'KG', 'Primary', 'JHS'];

// Headteacher overview: key counts, plus a setup guide until the school is set up. Daily follow-up appears once classes exist.
export function GettingStarted({ schoolId, schoolName, displayName, csrfToken, children }: { schoolId: string; schoolName: string; displayName: string; csrfToken: string; children: React.ReactNode }) {
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
    { done: progress.teachers > 0, title: 'Give your teachers a sign-in', why: 'Each teacher gets a temporary password to share with them privately.', href: '#/settings/staff', go: 'Add staff' },
    { done: progress.assignments > 0, title: 'Assign teachers to classes', why: 'A teacher only sees the classes you assign to them.', href: '#/settings/assignments', go: 'Assign teachers' },
    { done: progress.learners > 0, title: 'Add your learners', why: 'Upload your class lists from Excel (CSV), or record learners one at a time.', href: '#/learners', go: 'Add learners' },
  ];
  const doneCount = steps.filter(s => s.done).length, next = steps.findIndex(s => !s.done);
  const hour = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', hour12: false }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Accra', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const header = <PageHeader eyebrow={dateLine} title={`${greeting}, ${displayName.split(' ')[0]}`} blurb={`${schoolName}${progress.years[0] ? ` · ${progress.years[0].name}` : ''}`}
    actions={next === -1 ? <><a className="button" href="#/attendance"><Icon name="event_available"/>Take attendance</a><a className="button secondary" href="#/fees"><Icon name="payments"/>Record payment</a><a className="button secondary" href="#/notices"><Icon name="send"/>Send notice</a></> : undefined}/>;
  const stats = <div className="stats">
    <Stat label="Learners" value={progress.learners} caption="Enrolled in your school" icon="groups"/>
    <Stat label="Classes" value={progress.classes} caption={progress.years[0] ? progress.years[0].name : 'No academic year yet'} icon="meeting_room"/>
    <Stat label="Teachers" value={progress.teachers} caption="With a sign-in" icon="badge"/>
    <Stat label="Assignments" value={progress.assignments} caption="Teacher to class" icon="assignment_ind" tone={progress.assignments ? 'neutral' : 'caution'}/>
  </div>;
  if (next === -1) return <>{header}{stats}{children}</>;
  return <>
    {header}
    {progress.classes > 0 && stats}
    <section aria-labelledby="setup-title" className="setup">
      <p className="progress-label">Getting started · {doneCount} of {steps.length} done</p>
      <h2 id="setup-title">Let's get {schoolName} ready</h2>
      {error && <p role="alert">{error}</p>}
      <ol className="steps">{steps.map((s, i) => <li key={s.title} className={s.done ? 'done' : i === next ? 'current' : ''} aria-current={i === next ? 'step' : undefined}>
        <strong>{s.title}</strong>
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
        {i === next && i > 1 && <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>Check again</button>}
      </li>)}</ol>
    </section>
    {progress.classes > 0 && children}
  </>;
}
