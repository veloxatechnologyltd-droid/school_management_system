import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, Pager, Pill, Tabs } from '../lib/ui';

type Account = { user_id: string; display_name: string; login: string; role: string; revoked_at: string | null; must_change_password: boolean; phone: string | null };
type Credentials = { label: string; email: string; temporaryPassword: string };
type Group = 'teacher' | 'office' | 'guardian';
const roleNames: Record<string, string> = { teacher: 'Teacher', frontdesk: 'Front desk', accountant: 'Accountant', guardian: 'Parent or guardian', headteacher: 'Headteacher' };
const groupOf = (role: string): Group => role === 'teacher' ? 'teacher' : role === 'guardian' ? 'guardian' : 'office';
const groupRoles: Record<Group, string[]> = { teacher: ['teacher'], office: ['frontdesk', 'accountant'], guardian: ['guardian'] };
const pageSize = 25;

export function Accounts({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [group, setGroup] = useState<Group>('teacher');
  const [searchInput, setSearchInput] = useState(''); const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'teacher' });
  const [managing, setManaging] = useState<Account | null>(null);
  const [phone, setPhoneText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { 'x-csrf-token': csrfToken };
  const load = useCallback(async () => {
    try { setAccounts((await request<{ items: Account[] }>(`/schools/${schoolId}/accounts`)).items); }
    catch (e) { setError((e as Error).message); } finally { setLoaded(true); }
  }, [schoolId]);
  useEffect(() => { void load(); }, [load]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await load(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  const create = (event: FormEvent) => { event.preventDefault(); void act(async () => {
    const result = await request<{ email: string; temporaryPassword: string }>(`/schools/${schoolId}/accounts`, { method: 'POST', headers, body: JSON.stringify(form) });
    setCredentials({ label: `${roleNames[form.role] ?? form.role}: ${form.name.trim()}`, email: result.email, temporaryPassword: result.temporaryPassword });
    setGroup(groupOf(form.role)); setOffset(0); setSearch(''); setSearchInput(''); setForm({ name: '', email: '', role: form.role }); setAdding(false);
  }); };
  const reset = (account: Account) => void act(async () => {
    const result = await request<{ temporaryPassword: string }>(`/schools/${schoolId}/accounts/${account.user_id}/reset-password`, { method: 'POST', headers, body: '{}' });
    setCredentials({ label: `New password for ${account.display_name}`, email: account.login, temporaryPassword: result.temporaryPassword }); setManaging(null);
  });
  const savePhone = (account: Account) => void act(async () => { await request(`/schools/${schoolId}/accounts/${account.user_id}/phone`, { method: 'POST', headers, body: JSON.stringify({ phone }) }); setNotice(phone.trim() ? `Phone number saved for ${account.display_name}.` : `Phone number removed for ${account.display_name}.`); setManaging(null); });
  const revoke = (account: Account) => void act(async () => { await request(`/schools/${schoolId}/accounts/${account.user_id}/revoke`, { method: 'POST', headers, body: '{}' }); setNotice(`${account.display_name} can no longer sign in to this school.`); setManaging(null); });
  const manage = (account: Account) => { setError(''); setNotice(''); setConfirmRemove(false); setPhoneText(account.phone ?? ''); setManaging(account); };

  const counts = useMemo(() => ({ teacher: accounts.filter(a => groupOf(a.role) === 'teacher').length, office: accounts.filter(a => groupOf(a.role) === 'office').length, guardian: accounts.filter(a => groupOf(a.role) === 'guardian').length }), [accounts]);
  const matching = useMemo(() => {
    const needle = search.toLowerCase();
    return accounts.filter(a => groupOf(a.role) === group && (!needle || a.display_name.toLowerCase().includes(needle) || a.login.toLowerCase().includes(needle) || (a.phone ?? '').includes(needle)));
  }, [accounts, group, search]);
  const shown = matching.slice(offset, offset + pageSize);
  const messages = <>{error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}</>;
  const status = (a: Account) => a.revoked_at ? <Pill tone="neutral">Access removed</Pill> : a.must_change_password ? <Pill tone="caution">No password chosen yet</Pill> : <Pill tone="positive">Active</Pill>;
  const noun = group === 'teacher' ? 'teachers' : group === 'guardian' ? 'parents and guardians' : 'staff';

  return <section aria-label="Staff and family accounts" className="page">
    {!adding && !managing && messages}
    {credentials && <div role="status" className="credentials"><strong>{credentials.label}</strong><p>Sign in with: {credentials.email}<br/>Temporary password: <code>{credentials.temporaryPassword}</code></p><p className="muted">Shown once. Share it privately.</p><button type="button" className="secondary" onClick={() => setCredentials(null)}>I have copied it</button></div>}
    <Card title="Staff and family accounts" hint="Each person gets a temporary password and must choose their own." flush
      action={<button type="button" onClick={() => { setError(''); setNotice(''); setForm({ name: '', email: '', role: group === 'office' ? 'frontdesk' : group }); setAdding(true); }}><Icon name="person_add"/>Add account</button>}>
      <div className="toolbar">
        <Tabs label="Account type" value={group} onChange={value => { setGroup(value); setOffset(0); }} options={[{ id: 'teacher', label: `Teachers (${counts.teacher})` }, { id: 'office', label: `Head & office (${counts.office})` }, { id: 'guardian', label: `Parents (${counts.guardian})` }]}/>
      </div>
      <div className="toolbar">
        <form onSubmit={event => { event.preventDefault(); setOffset(0); setSearch(searchInput.trim()); }}><label className="search"><span className="sr-only">Search accounts</span><Icon name="search"/><input type="search" aria-label="Search accounts" maxLength={120} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Name, email or phone"/></label><button type="submit" className="secondary">Search</button></form>
        <span className="count">{matching.length} {noun}</span>
      </div>
      {shown.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th className="hide-sm">Sign-in</th><th>Status</th><th></th></tr></thead><tbody>{shown.map(a => <tr key={a.user_id}>
        <td>{a.display_name}<span className="sub">{roleNames[a.role] ?? a.role}</span></td>
        <td className="hide-sm">{a.login}{a.phone && <span className="sub">{a.phone}</span>}</td>
        <td>{status(a)}</td>
        <td className="num">{!a.revoked_at && a.role !== 'headteacher' && <button type="button" className="secondary" disabled={busy} aria-label={`Manage ${a.display_name}`} onClick={() => manage(a)}>Manage</button>}</td>
      </tr>)}</tbody></table></div> : !loaded ? <p role="status" className="card-body muted">Loading accounts…</p> : <Empty title={search ? 'No accounts match this search' : `No ${noun} yet`} hint={search ? undefined : 'Use Add account to give someone a sign-in.'}/>}
      <Pager offset={offset} shown={shown.length} total={matching.length} noun={noun} onMove={setOffset}/>
    </Card>
    {adding && <Dialog title="Add an account" onClose={() => setAdding(false)}>
      {messages}
      <form onSubmit={create}>
        <label>Full name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={120}/></label>
        <label>Email or mobile number<input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@example.com or 024 123 4567" required/></label>
        <label>Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{[...groupRoles.teacher, ...groupRoles.office, ...groupRoles.guardian].map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select></label>
        <div className="actions"><button disabled={busy}>Create account</button><button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button></div>
      </form>
    </Dialog>}
    {managing && <Dialog title={`Manage ${managing.display_name}`} onClose={() => setManaging(null)}>
      {messages}
      <p className="muted">{roleNames[managing.role] ?? managing.role} · {managing.login}</p>
      <h4>Password</h4>
      <p className="muted">Make a new temporary password if they forgot theirs. They choose their own when they sign in.</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => reset(managing)}>Reset password</button>
      <h4>Phone number</h4>
      <form onSubmit={event => { event.preventDefault(); savePhone(managing); }}>
        <label>Mobile number (for SMS notices; leave empty to remove)<input value={phone} onChange={e => setPhoneText(e.target.value)} maxLength={40} placeholder="024 123 4567"/></label>
        <button className="secondary" disabled={busy}>Save phone number</button>
      </form>
      <h4>Access</h4>
      {confirmRemove
        ? <div className="actions"><span>Remove {managing.display_name}'s access to this school?</span><button type="button" disabled={busy} onClick={() => revoke(managing)}>Yes, remove access</button><button type="button" className="secondary" onClick={() => setConfirmRemove(false)}>Keep access</button></div>
        : <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove access</button>}
    </Dialog>}
  </section>;
}
