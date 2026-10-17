import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, Pill } from '../lib/ui';
import { PracticeDialog } from './Practice';

type Subject = { id: string; name: string };
type Indicator = { id: string; grade: string | null; code: string | null; strand: string | null; sub_strand: string | null; description: string; origin: 'official' | 'local'; source_note: string; mine: boolean; retired_at: string | null; retirement_reason: string | null };

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
// part "indicators" is the Curriculum page (the topics the school teaches); part "sharing" is the two family switches kept in Settings.
export function Curriculum({ schoolId, csrfToken, role = 'headteacher', part = 'indicators' }: { schoolId: string; csrfToken: string; role?: string; part?: 'indicators' | 'sharing' }) {
  const [subjects, setSubjects] = useState<Subject[]>([]); const [subjectId, setSubjectId] = useState('');
  const [items, setItems] = useState<Indicator[]>([]); const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ origin: 'official', sourceNote: '', grade: '', lines: '' });
  const [gradeFilter, setGradeFilter] = useState(''); const [practiceFor, setPracticeFor] = useState('');
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
    await send('/assessment/indicators', { subjectId, origin: form.origin, sourceNote: form.sourceNote, ...(form.grade.trim() ? { grade: form.grade.trim() } : {}), items: parsed });
    setAdding(false); setForm({ ...form, lines: '' }); await load(); setMessage(`Added ${parsed.length} indicator(s).`);
  }); };
  const retire = (i: Indicator) => { const reason = window.prompt(`Why is "${i.code ?? i.description}" being retired? Assessments already tagged keep it.`); if (!reason || reason.trim().length < 3) return;
    void act(async () => { await send(`/assessment/indicators/${i.id}/retire`, { reason }); await load(); setMessage('Indicator retired.'); }); };
  const grades = [...new Set(items.map(i => i.grade).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const shown = items.filter(i => !gradeFilter || (gradeFilter === '-' ? !i.grade : i.grade === gradeFilter));
  const current = shown.filter(i => !i.retired_at).length;

  if (part === 'sharing') return <section aria-label="Family sharing and home practice">
    <FamilySharing schoolId={schoolId} csrfToken={csrfToken}/>
    <HomePracticeSwitch schoolId={schoolId} csrfToken={csrfToken}/>
  </section>;
  return <section aria-label="Curriculum indicators" className="page">
    <p className="muted">Enter the topics (indicators) your school teaches for each subject, from your curriculum documents or scheme of work. The headteacher and teachers can add them; you can retire your own, and the headteacher any. Teachers tag them on class work on the Assessment page, and Performance then shows which ones a class has not yet mastered. Approve a topic for the term on the Learning material tab and Claude prepares its lesson and practice. Mark codes as official only when copied from the official curriculum.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <Card flush>
      <div className="toolbar">
        <label>Subject<select value={subjectId} onChange={e => setSubjectId(e.target.value)}>{!subjects.length && <option value="">Add subjects first</option>}{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {grades.length > 0 && <label>Grade<select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}><option value="">All grades</option>{grades.map(g => <option key={g} value={g}>{g}</option>)}<option value="-">No grade</option></select></label>}
        <button type="button" disabled={!subjectId} onClick={() => setAdding(true)}><Icon name="add"/>Add indicators</button>
        <span className="count">{current} current</span>
      </div>
      {!shown.length ? <Empty title="No indicators for this subject yet" hint="Add them from your curriculum or scheme of work."/>
        : <div className="table-wrap"><table><thead><tr><th>Grade</th><th>Code</th><th>Indicator</th><th>Source</th><th/></tr></thead><tbody>
          {shown.map(i => <tr key={i.id} className={i.retired_at ? 'muted' : undefined}><td>{i.grade ?? 'Any'}</td><td>{i.code ?? '–'}</td>
            <td>{i.description}{(i.strand || i.sub_strand) && <span className="sub">{[i.strand, i.sub_strand].filter(Boolean).join(' · ')}</span>}{i.retired_at && <span className="sub">Retired: {i.retirement_reason}</span>}</td>
            <td><Pill tone={i.origin === 'official' ? 'info' : 'neutral'}>{i.origin === 'official' ? 'Official' : 'School'}</Pill><span className="sub">{i.source_note}</span></td>
            <td>{!i.retired_at && <div className="row-actions"><button type="button" className="secondary small" onClick={() => setPracticeFor(i.id)}>Practice</button>{(role === 'headteacher' || i.mine) && <button type="button" className="secondary small" disabled={busy} onClick={() => retire(i)}>Retire</button>}</div>}</td></tr>)}</tbody></table></div>}
    </Card>
    {practiceFor && <PracticeDialog schoolId={schoolId} csrfToken={csrfToken} indicatorId={practiceFor} onClose={() => setPracticeFor('')}/>}
    {adding && <Dialog title={`Add indicators · ${subjects.find(s => s.id === subjectId)?.name ?? ''}`} wide onClose={() => setAdding(false)}>
      <form onSubmit={add}>
        <label>Where these come from<select value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })}><option value="official">Official curriculum (codes as published)</option><option value="local">The school's own (scheme of work, local additions)</option></select></label>
        <label>Grade (optional)<input value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })} maxLength={40} placeholder="e.g. Basic 5, as your classes are named"/></label>
        <label>Source<input value={form.sourceNote} onChange={e => setForm({ ...form, sourceNote: e.target.value })} required minLength={3} maxLength={300} placeholder="e.g. NaCCA curriculum, Basic 5 Mathematics, 2019"/></label>
        <label>Indicators, one per line: code | strand | sub-strand | description<textarea rows={8} value={form.lines} onChange={e => setForm({ ...form, lines: e.target.value })} required placeholder={'B5.1.3.1.1 | Number | Fractions | Add and subtract fractions with like denominators\nRead a short passage aloud with expression'}/></label>
        <p className="muted">{parsed.length} indicator(s) ready. A line with no | is taken as the description only. Columns pasted from a spreadsheet work too.</p>
        <button disabled={busy || !parsed.length}>Add {parsed.length || ''} indicator(s)</button>
      </form>
    </Dialog>}
  </section>;
}

// Whether families see weekly progress and home-help notes. Published report cards are always visible to them.
function FamilySharing({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [setting, setSetting] = useState<{ shareWithFamilies: boolean; version: number | null } | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { request<{ shareWithFamilies: boolean; version: number | null }>(`/schools/${schoolId}/assessment/sharing`).then(setSetting).catch(e => setError((e as Error).message)); }, [schoolId]);
  const save = (share: boolean) => { if (!setting) return; setBusy(true); setError('');
    request<{ shareWithFamilies: boolean; version: number }>(`/schools/${schoolId}/assessment/sharing`, { method: 'PUT', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), shareWithFamilies: share, ...(setting.version ? { version: setting.version } : {}) }) })
      .then(setSetting).catch(e => setError((e as Error).message)).finally(() => setBusy(false)); };
  return <Card title="Progress shared with families" hint="Report cards are always shown to verified parents once published. Sharing adds each subject's monthly progress from class exercises, homework and tests, and the home-help notes teachers write in support plans.">
    {error && <p role="alert">{error}</p>}
    {setting && <div className="choice-row" role="radiogroup" aria-label="Progress shared with families">
      <label className="check"><input type="radio" name="family-sharing" checked={!setting.shareWithFamilies} disabled={busy} onChange={() => save(false)}/><span>Report cards only</span></label>
      <label className="check"><input type="radio" name="family-sharing" checked={setting.shareWithFamilies} disabled={busy} onChange={() => save(true)}/><span>Report cards, monthly progress and home-help notes</span></label></div>}
  </Card>;
}

// Whether the school offers home practice: children answering teacher-approved questions on a verified guardian's phone. Off until chosen.
function HomePracticeSwitch({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [setting, setSetting] = useState<{ enabled: boolean; version: number | null } | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { request<{ enabled: boolean; version: number | null }>(`/schools/${schoolId}/practice/settings`).then(setSetting).catch(e => setError((e as Error).message)); }, [schoolId]);
  const save = (enabled: boolean) => { if (!setting) return; setBusy(true); setError('');
    request<{ enabled: boolean; version: number }>(`/schools/${schoolId}/practice/settings`, { method: 'PUT', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), enabled, ...(setting.version ? { version: setting.version } : {}) }) })
      .then(setSetting).catch(e => setError((e as Error).message)).finally(() => setBusy(false)); };
  return <Card title="Home practice" hint="Children practise at home on a verified parent's phone: five questions at a time on the topics they find hardest, using only questions a teacher has approved. Teachers see what was practised beside class work; it never changes continuous assessment or report cards. There are no student logins and no marks, ranks or comparisons shown to families.">
    {error && <p role="alert">{error}</p>}
    {setting && <div className="choice-row" role="radiogroup" aria-label="Home practice">
      <label className="check"><input type="radio" name="home-practice" checked={!setting.enabled} disabled={busy} onChange={() => save(false)}/><span>Off</span></label>
      <label className="check"><input type="radio" name="home-practice" checked={setting.enabled} disabled={busy} onChange={() => save(true)}/><span>On: offer home practice to families</span></label></div>}
  </Card>;
}
