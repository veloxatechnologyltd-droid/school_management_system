import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, Pill } from '../lib/ui';

type Subject = { id: string; name: string };
type Indicator = { id: string; code: string | null; strand: string | null; sub_strand: string | null; description: string; origin: 'official' | 'local'; source_note: string; retired_at: string | null; retirement_reason: string | null };

// One indicator per line: "code | strand | sub-strand | description" (tabs work too, as pasted from a spreadsheet).
// A line with a single field is just the description.
function parseIndicators(text: string) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/\t|\|/).map(p => p.trim());
    if (parts.length === 1) return { description: parts[0]! };
    const [code, strand, subStrand, ...rest] = parts;
    const description = parts.length === 2 ? strand! : parts.length === 3 ? subStrand! : rest.join(' ').trim();
    return { ...(code ? { code } : {}), ...(parts.length >= 3 && strand ? { strand } : {}), ...(parts.length >= 4 && subStrand ? { subStrand } : {}), description };
  });
}

// The school's own curriculum indicators per subject. The platform ships no curriculum text; each batch records where it came from.
export function Curriculum({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([]); const [subjectId, setSubjectId] = useState('');
  const [items, setItems] = useState<Indicator[]>([]); const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ origin: 'official', sourceNote: '', lines: '' });
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const send = (path: string, body: object) => request(`/schools/${schoolId}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });

  useEffect(() => { request<{ items: Subject[] }>(`/schools/${schoolId}/assessment/subjects`).then(r => { setSubjects(r.items); setSubjectId(prior => prior || r.items[0]?.id || ''); }).catch(e => setError((e as Error).message)); }, [schoolId]);
  const load = useCallback(async () => {
    setItems([]); if (!subjectId) return;
    try { setItems((await request<{ items: Indicator[] }>(`/schools/${schoolId}/assessment/indicators?subjectId=${subjectId}`)).items); } catch (e) { setError((e as Error).message); }
  }, [schoolId, subjectId]);
  useEffect(() => { void load(); }, [load]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const parsed = parseIndicators(form.lines);
  const add = (e: FormEvent) => { e.preventDefault(); void act(async () => {
    if (!parsed.length) throw new Error('Enter at least one indicator.');
    await send('/assessment/indicators', { subjectId, origin: form.origin, sourceNote: form.sourceNote, items: parsed });
    setAdding(false); setForm({ ...form, lines: '' }); await load(); setMessage(`Added ${parsed.length} indicator(s).`);
  }); };
  const retire = (i: Indicator) => { const reason = window.prompt(`Why is "${i.code ?? i.description}" being retired? Assessments already tagged keep it.`); if (!reason || reason.trim().length < 3) return;
    void act(async () => { await send(`/assessment/indicators/${i.id}/retire`, { reason }); await load(); setMessage('Indicator retired.'); }); };
  const current = items.filter(i => !i.retired_at).length;

  return <section aria-label="Curriculum indicators">
    <h2>Curriculum indicators</h2>
    <p className="muted">Enter the indicators your school teaches for each subject, from your curriculum documents or scheme of work. Teachers tag them on class assessments, and Progress then shows which ones a class has not yet mastered. Mark codes as official only when copied from the official curriculum.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <Card flush>
      <div className="toolbar">
        <label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)}>{!subjects.length && <option value="">Add subjects first</option>}{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <button type="button" disabled={!subjectId} onClick={() => setAdding(true)}><Icon name="add"/>Add indicators</button>
        <span className="count">{current} current</span>
      </div>
      {!items.length ? <Empty title="No indicators for this subject yet" hint="Add them from your curriculum or scheme of work."/>
        : <div className="table-wrap"><table><thead><tr><th>Code</th><th>Indicator</th><th>Source</th><th/></tr></thead><tbody>
          {items.map(i => <tr key={i.id} className={i.retired_at ? 'muted' : undefined}><td>{i.code ?? '–'}</td>
            <td>{i.description}{(i.strand || i.sub_strand) && <span className="sub">{[i.strand, i.sub_strand].filter(Boolean).join(' · ')}</span>}{i.retired_at && <span className="sub">Retired: {i.retirement_reason}</span>}</td>
            <td><Pill tone={i.origin === 'official' ? 'info' : 'neutral'}>{i.origin === 'official' ? 'Official' : 'School'}</Pill><span className="sub">{i.source_note}</span></td>
            <td>{!i.retired_at && <button type="button" className="secondary" disabled={busy} onClick={() => retire(i)}>Retire</button>}</td></tr>)}</tbody></table></div>}
    </Card>
    {adding && <Dialog title={`Add indicators · ${subjects.find(s => s.id === subjectId)?.name ?? ''}`} wide onClose={() => setAdding(false)}>
      <form onSubmit={add}>
        <label>Where these come from<select value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })}><option value="official">Official curriculum (codes as published)</option><option value="local">The school's own (scheme of work, local additions)</option></select></label>
        <label>Source<input value={form.sourceNote} onChange={e => setForm({ ...form, sourceNote: e.target.value })} required minLength={3} maxLength={300} placeholder="e.g. NaCCA curriculum, Basic 5 Mathematics, 2019"/></label>
        <label>Indicators, one per line: code | strand | sub-strand | description<textarea rows={8} value={form.lines} onChange={e => setForm({ ...form, lines: e.target.value })} required placeholder={'B5.1.3.1.1 | Number | Fractions | Add and subtract fractions with like denominators\nRead a short passage aloud with expression'}/></label>
        <p className="muted">{parsed.length} indicator(s) ready. A line with no | is taken as the description only. Columns pasted from a spreadsheet work too.</p>
        <button disabled={busy || !parsed.length}>Add {parsed.length || ''} indicator(s)</button>
      </form>
    </Dialog>}
  </section>;
}
