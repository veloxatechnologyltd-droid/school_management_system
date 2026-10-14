import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';

type Settings = { enabled: boolean; monthlyRunCap: number; acknowledgement: string | null; version: number; platformEnabled: boolean; providerConfigured: boolean; runsThisMonth: number };

export function AiSettings({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState({ enabled: false, monthlyRunCap: '200', acknowledgement: '' });
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const s = await request<Settings>(`/schools/${schoolId}/ai/settings`); setSettings(s); setForm({ enabled: s.enabled, monthlyRunCap: String(s.monthlyRunCap), acknowledgement: s.acknowledgement ?? '' }); }
    catch (e) { setError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await request(`/schools/${schoolId}/ai/settings`, { method: 'PUT', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), enabled: form.enabled, monthlyRunCap: Number(form.monthlyRunCap), ...(form.acknowledgement.trim() ? { acknowledgement: form.acknowledgement } : {}), ...(settings && settings.version ? { version: settings.version } : {}) }) });
      setMessage('AI settings saved.'); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!settings) return error ? <p role="alert">{error}</p> : null;
  return <section aria-label="AI assistance settings">
    <h2>AI drafting assistance</h2>
    <p className="muted">When switched on, teachers can ask Claude (Anthropic's AI) to draft three things: Nursery/KG progress notes from a child's observations, the class teacher's remark on Primary/JHS report cards from the computed results, and short practice worksheets for a curriculum indicator. No names, admission numbers or marks are sent; every draft is checked before it is shown, and nothing is saved or shared until a teacher edits it and the usual approvals happen. It is off unless you enable it.</p>
    {!settings.platformEnabled && <p className="muted">The platform administrator has not switched AI on yet, so teachers currently receive a simple template draft only.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <form onSubmit={save}>
      <label><span><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })}/> Allow AI drafting in this school</span></label>
      <label>Most AI drafts per month<input type="number" min={1} max={5000} value={form.monthlyRunCap} onChange={e => setForm({ ...form, monthlyRunCap: e.target.value })} required/></label>
      <label>Confirmation (required to switch on): who agreed that AI drafting is covered by your data-protection agreement<textarea value={form.acknowledgement} onChange={e => setForm({ ...form, acknowledgement: e.target.value })} maxLength={500}/></label>
      <button disabled={busy}>Save AI settings</button>
    </form>
    <p className="muted">Drafts made this month: {settings.runsThisMonth} of {settings.monthlyRunCap}.</p>
  </section>;
}
