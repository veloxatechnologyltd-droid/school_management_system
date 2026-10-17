import React, { FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../lib/ui';
import { activeChat, ask, chatKey, deleteChat, newChat, openChat, setDraft, useWorkspace } from '../lib/chatStore';

const suggestions: Record<string, string[]> = {
  headteacher: ['How is Basic 6 performing this term?', 'Who was absent most last week?', 'Which classes have the lowest attendance this month?', 'How did JHS 3 do in the latest mock?', 'How much in fees is still outstanding, and which classes owe most?', 'Which support plans are due for review?'],
  teacher: ['How is my class performing this term?', 'Which topics is my class weakest in, and what can I do?', 'Who in my class was absent most last week?', 'Which of my students need attention right now?'],
};
const toolLabel: Record<string, string> = { school_overview: 'school overview', class_performance: 'class performance', curriculum_gaps: 'curriculum gaps', practice_materials: 'practice materials', attendance_report: 'attendance',
  find_learner: 'student search', learner_profile: 'student profile', support_plans: 'support plans', mock_results: 'mock results', fees_summary: 'fees' };

// Inline text: **bold** and learner references [[L-…]] shown as the learner's name (names never go to the AI provider).
function inline(text: string, people: Record<string, string>, key: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[\[L-[0-9a-f-]{36}\]\])/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
    const ref = part.match(/^\[\[(L-[0-9a-f-]{36})\]\]$/);
    if (ref) return <span key={`${key}-${i}`} className="learner-chip">{people[ref[1]!] ?? 'a student'}</span>;
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

// Kobby AI, the school assistant: ask about classes, attendance, students, support plans, mocks and fees in plain words.
// It is laid out like the chat apps people already know: the chats so far down the left, one conversation in the middle, the question box at the bottom.
// Conversations are kept in this browser while the person stays signed in (see lib/chatStore.ts), so they are still here after they visit
// another page or reload. Each question is answered from the school's records with the asker's own access.
export function Assistant({ schoolId, csrfToken, role, displayName }: { schoolId: string; csrfToken: string; role: string; displayName: string }) {
  const key = chatKey(schoolId, csrfToken);
  const space = useWorkspace(key), chat = activeChat(space);
  const { turns, people, used, draft, busy, error } = chat;
  const [panel, setPanel] = useState(false), [query, setQuery] = useState(''), [confirming, setConfirming] = useState('');
  const log = useRef<HTMLDivElement>(null), end = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), shown = useRef('');
  useEffect(() => {
    // Opening a conversation shows its latest message without moving the page; new messages scroll smoothly into view.
    if (shown.current !== chat.id) { shown.current = chat.id; if (log.current) log.current.scrollTop = log.current.scrollHeight; return; }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.id, turns.length, busy]);
  // The question box grows with what is typed, up to a few lines.
  useLayoutEffect(() => { const box = input.current; if (!box) return; box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 200)}px`; }, [draft, chat.id]);

  const send = (question: string) => { void ask(key, schoolId, csrfToken, question).then(() => input.current?.focus()); };
  const submit = (e: FormEvent) => { e.preventDefault(); send(draft); };
  const begin = () => { newChat(key); setPanel(false); setConfirming(''); setTimeout(() => input.current?.focus(), 0); };
  const needle = query.trim().toLowerCase();
  const history = space.chats.filter(c => c.turns.length && (!needle || c.title.toLowerCase().includes(needle))).sort((a, b) => b.at - a.at);
  const first = displayName.split(' ')[0] ?? '';

  return <section className={`kobby${panel ? ' history-open' : ''}`} aria-label="Kobby AI">
    <aside className="kobby-side" aria-label="Your chats">
      <div className="kobby-side-top">
        <button type="button" className="kobby-new" onClick={begin} disabled={!turns.length}><Icon name="edit_square"/>New chat</button>
        <label className="search kobby-search"><span className="sr-only">Search your chats</span><Icon name="search"/><input type="search" aria-label="Search your chats" value={query} maxLength={80} onChange={e => setQuery(e.target.value)} placeholder="Search chats"/></label>
      </div>
      <nav className="kobby-list" aria-label="Chat history">
        {history.length ? <ul>{history.map(c => <li key={c.id} className={c.id === chat.id ? 'active' : undefined}>
          {confirming === c.id
            ? <div className="kobby-confirm" role="group" aria-label={`Delete ${c.title}`}><span>Delete this chat?</span><button type="button" className="small" onClick={() => { deleteChat(key, c.id); setConfirming(''); }}>Delete</button><button type="button" className="secondary small" onClick={() => setConfirming('')}>Keep</button></div>
            : <><button type="button" className="kobby-item" aria-current={c.id === chat.id ? 'true' : undefined} onClick={() => { openChat(key, c.id); setPanel(false); }}><span>{c.title}</span>{c.busy && <span className="dots" aria-label="Answering"><i/><i/><i/></span>}</button>
              <button type="button" className="kobby-del" aria-label={`Delete chat: ${c.title}`} disabled={c.busy} onClick={() => setConfirming(c.id)}><Icon name="delete"/></button></>}
        </li>)}</ul> : <p className="muted kobby-none">{needle ? 'No chats match your search.' : 'Your chats will appear here.'}</p>}
      </nav>
      <p className="kobby-privacy">Chats stay in this browser while you are signed in. Signing out clears them.</p>
    </aside>
    {panel && <button type="button" className="kobby-scrim" aria-label="Close your chats" onClick={() => setPanel(false)}/>}
    <div className="kobby-main">
      <div className="kobby-head">
        <button type="button" className="icon-button kobby-toggle" aria-label="Show your chats" aria-expanded={panel} onClick={() => setPanel(true)}><Icon name="menu_open"/></button>
        <h2>Kobby AI</h2>{chat.title && <span className="kobby-chat-title">{chat.title}</span>}
      </div>
      <div className="kobby-thread" aria-live="polite" ref={log}>
        <div className="kobby-col">
          {!turns.length && <div className="kobby-empty">
            <span className="kobby-logo" aria-hidden="true"><Icon name="auto_awesome"/></span>
            <h3>{first ? `Hi ${first}, how can I help?` : 'How can I help?'}</h3>
            <p className="muted">Ask about your school in plain words. Answers come from your school's records, limited to what your account can see. You can follow up, for example "What can we do about it?"</p>
            <div className="kobby-suggestions">{(suggestions[role] ?? suggestions.teacher!).map(s => <button type="button" key={s} className="kobby-suggestion" onClick={() => send(s)} disabled={busy}>{s}</button>)}</div>
          </div>}
          {turns.map((t, i) => t.role === 'user'
            ? <div key={i} className="kobby-msg user"><p>{t.text}</p></div>
            : <div key={i} className="kobby-msg assistant"><span className="kobby-avatar" aria-hidden="true"><Icon name="auto_awesome"/></span><div className="kobby-body"><Rendered text={t.text} people={people}/>
              {used[i]?.length ? <p className="bubble-source">Checked: {[...new Set(used[i])].map(n => toolLabel[n] ?? n).join(', ')}</p> : null}</div></div>)}
          {busy && <div className="kobby-msg assistant" role="status"><span className="kobby-avatar" aria-hidden="true"><Icon name="auto_awesome"/></span><div className="kobby-body kobby-wait"><span className="dots" aria-hidden="true"><i/><i/><i/></span> Looking through the school records…</div></div>}
          <div ref={end}/>
        </div>
      </div>
      <div className="kobby-compose">
        {error && <p role="alert">{error}</p>}
        <form className="kobby-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="kobby-question">Your question</label>
          <textarea id="kobby-question" ref={input} rows={1} maxLength={4000} value={draft} placeholder="Ask Kobby AI about your school"
            onChange={e => setDraft(key, e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) send(draft); } }}/>
          <button type="submit" className="kobby-send" aria-label="Send question" disabled={busy || !draft.trim()}><Icon name="arrow_upward"/></button>
        </form>
        <p className="kobby-note">Kobby AI only reads records; it cannot change anything. Student names from your records are not sent to the AI provider. Check important figures on the page they come from.</p>
      </div>
    </div>
  </section>;
}
