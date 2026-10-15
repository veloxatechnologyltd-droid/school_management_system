import React, { FormEvent, useEffect, useRef } from 'react';
import { Icon } from '../lib/ui';
import { ask, chatKey, setDraft, startOver, useChat } from '../lib/chatStore';

const suggestions: Record<string, string[]> = {
  headteacher: ['How is Basic 6 performing this term?', 'Who was absent most last week?', 'Which classes have the lowest attendance this month?', 'How did JHS 3 do in the latest mock?', 'How much in fees is still outstanding, and which classes owe most?', 'Which support plans are due for review?'],
  teacher: ['How is my class performing this term?', 'Which topics is my class weakest in, and what can I do?', 'Who in my class was absent most last week?', 'Which of my learners need attention right now?'],
};
const toolLabel: Record<string, string> = { school_overview: 'school overview', class_performance: 'class performance', curriculum_gaps: 'curriculum gaps', practice_materials: 'practice materials', attendance_report: 'attendance',
  find_learner: 'learner search', learner_profile: 'learner profile', support_plans: 'support plans', mock_results: 'mock results', fees_summary: 'fees' };

// Inline text: **bold** and learner references [[L-…]] shown as the learner's name (names never go to the AI provider).
function inline(text: string, people: Record<string, string>, key: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[\[L-[0-9a-f-]{36}\]\])/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
    const ref = part.match(/^\[\[(L-[0-9a-f-]{36})\]\]$/);
    if (ref) return <span key={`${key}-${i}`} className="learner-chip">{people[ref[1]!] ?? 'a learner'}</span>;
    return <React.Fragment key={`${key}-${i}`}>{part.replace(/`/g, '')}</React.Fragment>;
  });
}
// A small, safe Markdown subset: headings, bullet and numbered lists, tables and paragraphs. No HTML is ever injected.
function Rendered({ text, people }: { text: string; people: Record<string, string> }) {
  const lines = text.split('\n'), out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!.trimEnd();
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) { const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()); if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells); i++; }
      const [head, ...body] = rows;
      out.push(<div key={`t${i}`} className="table-wrap"><table><thead><tr>{head!.map((c, j) => <th key={j}>{inline(c, people, `h${i}${j}`)}</th>)}</tr></thead>
        <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, people, `c${i}${k}${j}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const bullet = /^\s*[-*•]\s+/, numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const isNumbered = numbered.test(line), pattern = isNumbered ? numbered : bullet, items: string[] = [];
      while (i < lines.length && pattern.test(lines[i]!)) { items.push(lines[i]!.replace(pattern, '')); i++; }
      const List = isNumbered ? 'ol' : 'ul';
      out.push(<List key={`l${i}`}>{items.map((item, k) => <li key={k}>{inline(item, people, `l${i}${k}`)}</li>)}</List>);
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    out.push(heading ? <h4 key={`p${i}`}>{inline(heading[1]!, people, `p${i}`)}</h4> : <p key={`p${i}`}>{inline(line, people, `p${i}`)}</p>);
    i++;
  }
  return <>{out}</>;
}

// The school assistant: ask about classes, attendance, learners, support plans, mocks and fees in plain words.
// The conversation is kept in this browser while the person stays signed in (see lib/chatStore.ts), so it is still here after
// they visit another page or reload; "New conversation" clears it. Each question is answered from the school's records with the asker's own access.
export function Assistant({ schoolId, csrfToken, role }: { schoolId: string; csrfToken: string; role: string }) {
  const key = chatKey(schoolId, csrfToken);
  const { turns, people, used, draft, busy, error } = useChat(key);
  const log = useRef<HTMLDivElement>(null), end = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), opened = useRef(false);
  useEffect(() => {
    // Coming back to a saved chat shows its latest message without moving the page; new messages scroll smoothly into view.
    if (!opened.current) { opened.current = true; if (log.current) log.current.scrollTop = log.current.scrollHeight; return; }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  const send = (question: string) => { void ask(key, schoolId, csrfToken, question).then(() => input.current?.focus()); };
  const submit = (e: FormEvent) => { e.preventDefault(); send(draft); };
  const restart = () => { startOver(key); input.current?.focus(); };

  return <section className="assistant" aria-labelledby="assistant-title">
    <div className="assistant-head">
      <div><h2 id="assistant-title">Ask about your school</h2><p className="card-hint">Answers come from your school's records, limited to what your account can see. Check important figures on the page they come from.</p><p className="card-hint">{turns.length ? 'This conversation stays here while you are signed in. Start a new one any time.' : 'Your conversation is kept while you stay signed in.'}</p></div>
      {turns.length > 0 && <button type="button" className="secondary" onClick={restart} disabled={busy}><Icon name="add_comment"/>New conversation</button>}
    </div>
    <div className="assistant-log" aria-live="polite" ref={log}>
      {!turns.length && <div className="assistant-start">
        <p className="muted">Try one of these, or ask in your own words. You can follow up, for example "What can we do about it?"</p>
        <div className="assistant-suggestions">{(suggestions[role] ?? suggestions.teacher!).map(s => <button type="button" key={s} className="secondary" onClick={() => send(s)} disabled={busy}>{s}</button>)}</div>
      </div>}
      {turns.map((t, i) => <div key={i} className={`bubble bubble-${t.role}`}>
        {t.role === 'user' ? <p>{t.text}</p> : <Rendered text={t.text} people={people}/>}
        {t.role === 'assistant' && used[i]?.length ? <p className="bubble-source">Checked: {[...new Set(used[i])].map(n => toolLabel[n] ?? n).join(', ')}</p> : null}
      </div>)}
      {busy && <div className="bubble bubble-assistant bubble-wait" role="status"><span className="dots" aria-hidden="true"><i/><i/><i/></span> Looking through the school records…</div>}
      <div ref={end}/>
    </div>
    {error && <p role="alert">{error}</p>}
    <form className="assistant-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="assistant-question">Your question</label>
      <textarea id="assistant-question" ref={input} rows={2} maxLength={4000} value={draft} placeholder="Ask a question, e.g. How is Basic 6 doing in Mathematics?"
        onChange={e => setDraft(key, e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }} disabled={busy}/>
      <button type="submit" disabled={busy || !draft.trim()}><Icon name="send"/>Ask</button>
    </form>
    <p className="assistant-note">The assistant only reads records; it cannot change anything. Learner names from your records are not sent to the AI provider.</p>
  </section>;
}
