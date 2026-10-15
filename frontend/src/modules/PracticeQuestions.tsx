import React, { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Empty, Icon, Pill, when } from '../lib/ui';

type Saved = { level: number; kind: 'choice' | 'number'; prompt: string; options: string[] | null; correctOption: number | null; answer: number | null; explanation: string | null; retired?: { cause: string; reason: string } | null };
type Bank = { indicator: { retired_at: string | null }; canRetireAny: boolean;
  current: { id: string; source: string; approved_by_name: string; approved_at: string; mine: boolean; questions: Saved[] } | null;
  history: { id: string; approved_by_name: string; approved_at: string; retired_at: string; retirement_reason: string; questions: number }[] };
type Draft = { runId: string; source: string; note: string | null; questions: Saved[] };
// One question being edited: four option boxes (three at least), the right one chosen, or a number.
type Q = { key: string; level: number; kind: 'choice' | 'number'; prompt: string; options: string[]; correct: number; answer: string; explanation: string };
type Editor = { runId: string | null; questions: Q[]; before: string };
const levels = [[1, 'Level 1', 'easiest'], [2, 'Level 2', 'middle'], [3, 'Level 3', 'hardest']] as const;
const MIN = 5, MAX = 8;
let counter = 0;
const blank = (level: number, kind: 'choice' | 'number' = 'choice'): Q => ({ key: `q${++counter}`, level, kind, prompt: '', options: ['', '', '', ''], correct: 0, answer: '', explanation: '' });
const fromSaved = (q: Saved): Q => ({ key: `q${++counter}`, level: q.level, kind: q.kind, prompt: q.prompt, options: [...(q.options ?? []), '', '', '', ''].slice(0, 4), correct: q.correctOption ?? 0, answer: q.answer === null ? '' : String(q.answer), explanation: q.explanation ?? '' });
// What the server stores: blank option boxes are dropped and the right answer follows its option.
function toSaved(q: Q) {
  const base = { level: q.level, kind: q.kind, prompt: q.prompt.trim(), ...(q.explanation.trim() ? { explanation: q.explanation.trim() } : {}) };
  if (q.kind === 'number') return { ...base, answer: Number(q.answer.trim()) };
  const kept = q.options.map((text, i) => ({ text: text.trim(), i })).filter(o => o.text);
  return { ...base, options: kept.map(o => o.text), correctOption: kept.findIndex(o => o.i === q.correct) };
}
const complete = (q: Q) => q.prompt.trim().length >= 5 && (q.kind === 'number' ? q.answer.trim() !== '' && Number.isFinite(Number(q.answer)) : q.options.filter(o => o.trim()).length >= 3 && q.options[q.correct]?.trim() !== '');

// One question as a teacher checks it: the wording, every option with the correct one ticked, and the explanation.
function QuestionView({ q }: { q: Saved }) {
  return <>
    <strong className="q-prompt">{q.prompt}</strong>
    {q.kind === 'choice' ? <ul className="q-options">{q.options!.map((o, j) => <li key={j} className={j === q.correctOption ? 'right' : ''}><Icon name={j === q.correctOption ? 'check_circle' : 'radio_button_unchecked'}/><span>{o}{j === q.correctOption && <span className="sr-only"> (correct)</span>}</span></li>)}</ul> : <span className="q-number">Number answer: <strong>{q.answer}</strong></span>}
    {q.explanation && <span className="sub q-why">Why: {q.explanation}</span>}
    {q.retired && <span><Pill tone="critical">Retired</Pill> <span className="muted">{q.retired.cause === 'flag' ? q.retired.reason : `${q.retired.cause === 'check' ? 'By the automatic checks' : 'By a teacher'}: ${q.retired.reason}`}</span></span>}
  </>;
}

// The school's home-practice questions for one topic: Claude drafts three levels, the teacher checks every answer, edits and approves.
// Only approved questions can reach a family, and approved wording is kept: a change is a new set that replaces the old one.
export function PracticeQuestions({ schoolId, csrfToken, indicatorId, onChanged }: { schoolId: string; csrfToken: string; indicatorId: string; onChanged?: () => void }) {
  const [bank, setBank] = useState<Bank | null>(null); const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [checked, setChecked] = useState(false); const [showHistory, setShowHistory] = useState(false); const [drafting, setDrafting] = useState(false); const [editing, setEditing] = useState<string[]>([]);
  const base = `/schools/${schoolId}`;
  const load = () => request<Bank>(`${base}/assessment/indicators/${indicatorId}/questions`).then(setBank).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, [schoolId, indicatorId]);
  const send = <T,>(path: string, body?: object) => request<T>(`${base}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function act(work: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  // A drafted or existing set opens for review (each question read-only until edited); a blank set opens with every question ready to write.
  const open = (questions: Q[], runId: string | null, writing = false) => { setEditor({ runId, questions, before: JSON.stringify(questions.map(toSaved)) }); setEditing(writing ? questions.map(q => q.key) : []); setChecked(false); };
  const draft = () => void act(async () => {
    setDrafting(true);
    const r = await send<Draft>(`/ai/indicators/${indicatorId}/questions-draft`).finally(() => setDrafting(false));
    if (r.questions.length) { open(r.questions.map(fromSaved), r.runId); setMessage('Drafted with Claude. Work through every question and answer yourself before approving: a wrong answer would teach a child the wrong thing.'); }
    else { open(levels.flatMap(([level]) => Array.from({ length: MIN }, () => blank(level))), r.runId, true); setMessage(r.note?.startsWith('ai_disabled') || r.note === 'no_provider' ? 'AI drafting is off for this school, so write the questions yourself.' : 'Claude could not draft questions this time. Try again, or write them yourself.'); }
  });
  const set = (key: string, change: Partial<Q>) => setEditor(e => e && { ...e, questions: e.questions.map(q => q.key === key ? { ...q, ...change } : q) });
  const removeButton = (q: Q) => <button type="button" className="secondary small" onClick={() => setEditor(ed => ed && { ...ed, questions: ed.questions.filter(x => x.key !== q.key) })}>Remove question</button>;
  const counts = levels.map(([level]) => editor?.questions.filter(q => q.level === level).length ?? 0);
  const ready = !!editor && counts.every(n => n >= MIN && n <= MAX) && editor.questions.every(complete) && checked;
  const approve = (e: FormEvent) => { e.preventDefault(); if (!editor) return; void act(async () => {
    const questions = editor.questions.map(toSaved);
    await send(`/assessment/indicators/${indicatorId}/questions`, { operationId: crypto.randomUUID(), ...(editor.runId ? { runId: editor.runId } : {}), questions });
    if (editor.runId) void send(`/ai/runs/${editor.runId}/feedback`, { outcome: JSON.stringify(questions) === editor.before ? 'accepted' : 'edited' }).catch(() => undefined);
    setEditor(null); await load(); onChanged?.(); setMessage('Approved. Families of children who are weak in this topic can now be offered these questions, once the headteacher has switched home practice on.'); }); };
  const retire = () => { const reason = window.prompt('Why is this set being retired? (Children will no longer be offered it.)'); if (!reason || reason.trim().length < 3) return;
    void act(async () => { await send(`/assessment/practice-sets/${bank!.current!.id}/retire`, { operationId: crypto.randomUUID(), reason }); await load(); onChanged?.(); setMessage('Retired. Write or draft a new set to offer this topic again.'); }); };

  if (!bank) return error ? <p role="alert">{error}</p> : null;
  const current = bank.current, canEdit = !bank.indicator.retired_at;
  return <div className="question-bank">
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!editor && <>
      {!current ? <Empty title="No approved questions for this topic" hint="Draft three levels of questions with Claude, check them and approve. Until then, no child is offered practice on this topic."/> : <>
        <p><Pill tone="positive">Approved</Pill> <span className="muted">{current.questions.filter(q => !q.retired).length} questions in use{current.questions.some(q => q.retired) ? ` (${current.questions.filter(q => q.retired).length} retired)` : ''} · {current.source === 'ai' ? 'drafted with Claude and checked by' : 'written by'} {current.approved_by_name}, {when(current.approved_at)}</span></p>
        {levels.map(([level, name, hint]) => <details key={level} open={level === 1}><summary><strong>{name}</strong> <span className="muted">{hint} · {current.questions.filter(q => q.level === level).length} questions</span></summary>
          <ol className="q-list">{current.questions.filter(q => q.level === level).map((q, i) => <li key={i}><QuestionView q={q}/></li>)}</ol></details>)}
      </>}
      {drafting && <p role="status">Claude is drafting three levels of questions. This takes about 20 seconds.</p>}
      {canEdit && <div className="actions">
        <button type="button" disabled={busy} onClick={draft}><Icon name="auto_awesome"/>{drafting ? 'Drafting…' : current ? 'Draft a new set' : 'Draft questions'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => current ? open(current.questions.filter(q => !q.retired).map(fromSaved), null) : open(levels.flatMap(([level]) => Array.from({ length: MIN }, () => blank(level))), null, true)}>{current ? 'Edit as a new version' : 'Write questions'}</button>
        {current && (bank.canRetireAny || current.mine) && <button type="button" className="secondary" disabled={busy} onClick={retire}>Retire this set</button>}
      </div>}
      {bank.history.length > 0 && <p><button type="button" className="link-button" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide' : 'Show'} {bank.history.length} earlier {bank.history.length === 1 ? 'set' : 'sets'}</button></p>}
      {showHistory && <ul className="history">{bank.history.map(h => <li key={h.id}><strong>{h.questions} questions, approved by {h.approved_by_name}, {when(h.approved_at)}</strong><span>Retired {when(h.retired_at)}: {h.retirement_reason}</span></li>)}</ul>}
    </>}
    {editor && <form onSubmit={approve} className="q-editor">
      {levels.map(([level, name, hint], n) => <fieldset key={level} className="q-level"><legend>{name} <span className="muted">{hint} · {counts[n]} of {MIN}–{MAX}</span></legend>
        <ol className="q-list">{editor.questions.filter(q => q.level === level).map((q, i) => <li key={q.key}>
          {!editing.includes(q.key) && complete(q) ? <>
            <QuestionView q={toSaved(q) as unknown as Saved}/>
            <div className="q-actions"><button type="button" className="secondary small" onClick={() => setEditing(e => [...e, q.key])}>Edit</button>{removeButton(q)}</div>
          </> : <div className="q-card">
            <div className="field-row"><label>Question {i + 1}<textarea rows={2} value={q.prompt} maxLength={200} onChange={e => set(q.key, { prompt: e.target.value })} required minLength={5}/></label>
              <label className="q-kind">Answer type<select value={q.kind} onChange={e => set(q.key, { kind: e.target.value as Q['kind'] })}><option value="choice">Multiple choice</option><option value="number">A number</option></select></label></div>
            {q.kind === 'choice' ? <fieldset className="q-options-edit"><legend>Options: tick the correct one</legend>
              {q.options.map((o, j) => <label key={j} className="q-option"><input type="radio" name={`${q.key}-right`} checked={q.correct === j} onChange={() => set(q.key, { correct: j })} aria-label={`Option ${j + 1} is correct`}/>
                <input value={o} maxLength={80} placeholder={j < 3 ? `Option ${j + 1}` : 'Option 4 (optional)'} onChange={e => set(q.key, { options: q.options.map((x, k) => k === j ? e.target.value : x) })} aria-label={`Option ${j + 1}`}/></label>)}</fieldset>
              : <label>Correct number (no units; say the unit in the question)<input inputMode="decimal" value={q.answer} onChange={e => set(q.key, { answer: e.target.value })} placeholder="e.g. 12.5"/></label>}
            <label>Why (shown to the child after answering; optional)<input value={q.explanation} maxLength={200} onChange={e => set(q.key, { explanation: e.target.value })}/></label>
            <div className="q-actions"><button type="button" className="small" disabled={!complete(q)} onClick={() => setEditing(e => e.filter(k => k !== q.key))}>Done</button>{removeButton(q)}</div>
          
          </div>}</li>)}</ol>
        {counts[n]! < MAX && <button type="button" className="secondary small" onClick={() => { const q = blank(level); setEditor(ed => ed && { ...ed, questions: [...ed.questions, q] }); setEditing(e => [...e, q.key]); }}>Add a Level {level} question</button>}
      </fieldset>)}
      <label className="check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/><span>I have worked through every question and checked its answer. I approve these for children to practise.</span></label>
      <div className="actions"><button disabled={busy || !ready}>Approve questions</button><button type="button" className="secondary" disabled={busy} onClick={() => setEditor(null)}>Discard</button></div>
      {!ready && editor.questions.length > 0 && <p className="muted">Each level needs {MIN} to {MAX} complete questions, and the box above ticked.</p>}
    </form>}
  </div>;
}
