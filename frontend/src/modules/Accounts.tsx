import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';

type Account = { user_id: string; display_name: string; login: string; role: string; revoked_at: string | null; must_change_password: boolean; phone: string | null };
type Credentials = { label: string; email: string; temporaryPassword: string };
const roles = ['teacher', 'frontdesk', 'accountant', 'guardian'];

export function Accounts({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ name: '', email: '', role: 'teacher' });
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { 'x-csrf-token': csrfToken };
  const load = useCallback(async () => {
    try { setAccounts((await request<{ items: Account[] }>(`/schools/${schoolId}/accounts`)).items); }
    catch (e) { setError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void load(); }, [load]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const create = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const result = await request<{ email: string; temporaryPassword: string }>(`/schools/${schoolId}/accounts`, { method: 'POST', headers, body: JSON.stringify(form) });
    setCredentials({ label: `${form.role}: ${form.name.trim()}`, email: result.email, temporaryPassword: result.temporaryPassword }); setForm({ name: '', email: '', role: 'teacher' });
  }); };
  const reset = (account: Account) => void act(async () => {
    const result = await request<{ temporaryPassword: string }>(`/schools/${schoolId}/accounts/${account.user_id}/reset-password`, { method: 'POST', headers, body: '{}' });
    setCredentials({ label: `New password for ${account.display_name}`, email: account.login, temporaryPassword: result.temporaryPassword });
  });
  const setPhone = (account: Account) => { const value = window.prompt(`Mobile number for ${account.display_name} (for SMS notices). Leave empty to remove.`, account.phone ?? ''); if (value !== null) void act(async () => { await request(`/schools/${schoolId}/accounts/${account.user_id}/phone`, { method: 'POST', headers, body: JSON.stringify({ phone: value }) }); }); };
  const revoke = (account: Account) => { if (window.confirm(`Remove ${account.display_name}'s access to this school?`)) void act(async () => { await request(`/schools/${schoolId}/accounts/${account.user_id}/revoke`, { method: 'POST', headers, body: '{}' }); }); };

  return <section aria-label="Staff and family accounts">
    <h2>Staff and family accounts</h2>
    <p className="muted">Create sign-ins for teachers, front desk, accountants and guardians. Each person gets a temporary password and must choose their own.</p>
    {error && <p role="alert">{error}</p>}
    {credentials && <div role="status" className="credentials"><strong>{credentials.label}</strong><p>Sign in with: {credentials.email}<br/>Temporary password: <code>{credentials.temporaryPassword}</code></p><p className="muted">Shown once. Share it privately.</p><button type="button" className="secondary" onClick={() => setCredentials(null)}>I have copied it</button></div>}
    <form onSubmit={create}>
      <label>Full name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={120}/></label>
      <label>Email or mobile number<input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@example.com or 024 123 4567" required/></label>
      <label>Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{roles.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
      <button disabled={busy}>Create account</button>
    </form>
    <ul className="history">{accounts.map(a => <li key={a.user_id}><strong>{a.display_name} · {a.role}</strong><span>{a.login}{a.phone ? ` · ${a.phone}` : ''}{a.revoked_at ? ' · access removed' : a.must_change_password ? ' · has not chosen a password yet' : ''}</span>
      {!a.revoked_at && a.role !== 'headteacher' && <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => reset(a)}>Reset password</button><button type="button" className="secondary" disabled={busy} onClick={() => setPhone(a)}>Phone number</button><button type="button" className="secondary" disabled={busy} onClick={() => revoke(a)}>Remove access</button></div>}</li>)}</ul>
  </section>;
}
