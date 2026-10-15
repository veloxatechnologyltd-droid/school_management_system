import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';

type SchoolRow = { id: string; name: string; members: number; headteachers: number };
type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type Credentials = { label: string; email: string; temporaryPassword: string };
const roles = ['headteacher', 'teacher', 'frontdesk', 'accountant', 'guardian'];
type Staff = { id: string; userId: string; name: string; login: string; role: string; grantedAt: string; revokedAt: string | null };
const contentRoleName: Record<string, string> = { author: 'Author', reviewer: 'Reviewer', lead: 'Lead' };

export function PlatformAdmin({ csrfToken, onEnter }: { csrfToken: string; onEnter: (schoolId: string) => Promise<void> }) {
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [newSchool, setNewSchool] = useState({ name: '', headteacherName: '', headteacherEmail: '' });
  const [userFor, setUserFor] = useState('');
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'teacher' });
  const headers = { 'x-csrf-token': csrfToken };
  const [staff, setStaff] = useState<Staff[]>([]);
  const [newStaff, setNewStaff] = useState({ role: 'author', email: '', name: '' });
  const [newAccount, setNewAccount] = useState(false);

  const load = useCallback(async (offset = 0) => {
    try {
      const page = await request<Page<SchoolRow>>(`/platform/schools?limit=100&offset=${offset}`);
      setSchools(prior => offset ? [...prior, ...page.items] : page.items); setTotal(page.total);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadStaff = useCallback(async () => {
    try { setStaff((await request<{ items: Staff[] }>('/platform/content-staff')).items); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void loadStaff(); }, [loadStaff]);

  async function createSchool(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setCredentials(null);
    try {
      const result = await request<{ schoolId: string; headteacher: { email: string; temporaryPassword: string } }>('/platform/schools', { method: 'POST', headers, body: JSON.stringify(newSchool) });
      setCredentials({ label: `Headteacher for ${newSchool.name.trim()}`, ...result.headteacher });
      setNewSchool({ name: '', headteacherName: '', headteacherEmail: '' }); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function createUser(event: FormEvent, schoolId: string, schoolName: string) {
    event.preventDefault(); setBusy(true); setError(''); setCredentials(null);
    try {
      const result = await request<{ email: string; temporaryPassword: string }>(`/platform/schools/${schoolId}/users`, { method: 'POST', headers, body: JSON.stringify(newUser) });
      setCredentials({ label: `${newUser.role} at ${schoolName}`, email: result.email, temporaryPassword: result.temporaryPassword });
      setNewUser({ name: '', email: '', role: 'teacher' }); setUserFor(''); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function addStaff(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setCredentials(null);
    try {
      const result = await request<{ email: string; temporaryPassword?: string }>('/platform/content-staff', { method: 'POST', headers, body: JSON.stringify({ role: newStaff.role, email: newStaff.email, ...(newAccount ? { name: newStaff.name } : {}) }) });
      if (result.temporaryPassword) setCredentials({ label: `Content ${newStaff.role} account`, email: result.email, temporaryPassword: result.temporaryPassword });
      setNewStaff({ role: 'author', email: '', name: '' }); setNewAccount(false); await loadStaff();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function revokeStaff(id: string) {
    setBusy(true); setError('');
    try { await request(`/platform/content-staff/${id}/revoke`, { method: 'POST', headers, body: '{}' }); await loadStaff(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function enter(schoolId: string) {
    setBusy(true); setError('');
    try { await request(`/platform/schools/${schoolId}/enter`, { method: 'POST', headers, body: '{}' }); await onEnter(schoolId); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <section aria-label="Platform administration">
    <h2>Platform administration</h2>
    <p className="muted">Create school accounts and open a school for support. Every school you enter is recorded in that school's audit history.</p>
    {error && <p role="alert">{error}</p>}
    {credentials && <div role="status" className="credentials"><strong>{credentials.label}</strong><p>Email: {credentials.email}<br/>Temporary password: <code>{credentials.temporaryPassword}</code></p><p className="muted">Shown once. Share it privately; they must choose a new password at first sign-in.</p><button type="button" className="secondary" onClick={() => setCredentials(null)}>I have copied it</button></div>}
    <form onSubmit={createSchool}><h3>Create school account</h3>
      <label>School name<input value={newSchool.name} onChange={e => setNewSchool({ ...newSchool, name: e.target.value })} required minLength={3} maxLength={120}/></label>
      <label>Headteacher name<input value={newSchool.headteacherName} onChange={e => setNewSchool({ ...newSchool, headteacherName: e.target.value })} required minLength={2} maxLength={120}/></label>
      <label>Headteacher email<input type="email" value={newSchool.headteacherEmail} onChange={e => setNewSchool({ ...newSchool, headteacherEmail: e.target.value })} required/></label>
      <button disabled={busy}>{busy ? 'Creating…' : 'Create school'}</button></form>
    <h3>Schools ({total})</h3>
    {schools.length ? <ul className="history">{schools.map(s => <li key={s.id}><strong>{s.name}</strong><span>{s.members} people · {s.headteachers} headteacher(s)</span>
      <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => void enter(s.id)}>Open this school</button><button type="button" className="secondary" onClick={() => setUserFor(userFor === s.id ? '' : s.id)}>Add a user</button></div>
      {userFor === s.id && <form onSubmit={e => void createUser(e, s.id, s.name)}>
        <label>Name<input value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} required minLength={2} maxLength={120}/></label>
        <label>Email<input type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} required/></label>
        <label>Role<select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>{roles.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
        <button disabled={busy}>Create user</button></form>}</li>)}</ul> : <p>No schools yet.</p>}
    {schools.length < total && <button type="button" className="secondary" onClick={() => void load(schools.length)}>Show more schools</button>}
    <h3>Content team</h3>
    <p className="muted">People who write and review the questions and parent guides shared by every school. These roles are separate from school roles: being the platform administrator does not give one.</p>
    {staff.some(s => !s.revokedAt) ? <ul className="history">{staff.filter(s => !s.revokedAt).map(s => <li key={s.id}><strong>{s.name}</strong><span>{contentRoleName[s.role]} · {s.login}</span><div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => void revokeStaff(s.id)}>Remove this role</button></div></li>)}</ul> : <p>Nobody is on the content team yet.</p>}
    <form onSubmit={addStaff}><h3>Add to the content team</h3>
      <label>Role<select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}><option value="author">Author: writes questions and guides</option><option value="reviewer">Reviewer: approves or rejects other people's work</option><option value="lead">Lead: also keeps the catalogue</option></select></label>
      <label>Email<input type="email" value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })} required/></label>
      <label className="check"><input type="checkbox" checked={newAccount} onChange={e => setNewAccount(e.target.checked)}/><span>This person has no account yet: create one</span></label>
      {newAccount && <label>Name<input value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })} required minLength={2} maxLength={120}/></label>}
      <button disabled={busy}>{busy ? 'Adding…' : 'Add'}</button></form>
  </section>;
}
