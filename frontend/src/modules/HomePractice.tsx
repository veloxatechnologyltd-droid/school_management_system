import React, { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Dialog, Empty, Icon, Pill, todayInAccra } from '../lib/ui';

type Topic = { indicatorId: string; subject: string; topic: string; level: number; levels: number; sessionsThisWeek: number; lastPracticedOn: string | null;
  open: { sessionId: string; answered: number; total: number } | null; availableToday: boolean };
type Practised = { indicatorId: string; subject: string; topic: string; level: number; levels: number; done: boolean; sessionsThisWeek: number; lastPracticedOn: string };
type Overview = { enabled: false } | { enabled: true; firstName: string; topics: Topic[]; practised: Practised[] };
type Question = { questionId: string; position: number; kind: 'choice' | 'number'; prompt: string; options: string[] | null };
type Summary = { correct: number; total: number; outcome: 'up' | 'stay' | 'down' | 'done'; levelAfter: number };
type View = { sessionId: string; subject: string; topic: string; level: number; total: number; answered: number; next: Question | null; summary: Summary | null };
type Result = { correct: boolean; correctOption: number | null; correctNumber: number | null; explanation: string | null; answered: number; total: number; summary: Summary | null };

const dayMs = 86400000;
const ago = (iso: string) => { const n = Math.round((Date.parse(`${todayInAccra()}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / dayMs); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
const times = (n: number) => n === 1 ? '1 session' : `${n} sessions`;
const Dots = ({ level, levels }: { level: number; levels: number }) => <span className="level-dots" role="img" aria-label={`Level ${level} of ${levels}`}>{Array.from({ length: levels }, (_, i) => <span key={i} className={i < level ? 'on' : ''}/>)}</span>;

// Practice at home: short sessions for a child on the topics class work shows are hardest, from questions a teacher approved.
// Families see the topic, the level reached and sessions this week. Never marks, percentages, ranks or other children.
export function HomePractice({ schoolId, csrfToken, childId }: { schoolId: string; csrfToken: string; childId: string }) {
  const [data, setData] = useState<Overview | null>(null); const [error, setError] = useState(''); const [session, setSession] = useState<{ topic: Topic; view: View } | null>(null); const [busy, setBusy] = useState('');
  const base = `/schools/${schoolId}/guardian/children/${childId}/practice`;
  const load = () => request<Overview>(base).then(setData).catch(e => setError((e as Error).message));
  useEffect(() => { let live = true; setData(null); setError(''); request<Overview>(base).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [schoolId, childId]);
  const begin = (topic: Topic) => { setBusy(topic.indicatorId); setError('');
    request<View>(`${base}/sessions`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), indicatorId: topic.indicatorId }) })
      .then(view => setSession({ topic, view })).catch(e => { setError((e as Error).message); void load(); }).finally(() => setBusy('')); };
  if (!data || !data.enabled) return error && data ? <p role="alert">{error}</p> : null;
  const { firstName, topics } = data;
  // Topics on offer already show their level and sessions; this list is for the ones finished or no longer on the list.
  const practised = data.practised.filter(p => !topics.some(t => t.indicatorId === p.indicatorId));
  return <section aria-label="Practice at home" className="page">
    <Card title="Practice at home" hint={`Short practice for ${firstName} on the topics class work shows are hardest. A teacher checked every question. Five questions at a time.`}>
      {error && <p role="alert">{error}</p>}
      {!topics.length ? <Empty title="Nothing to practise right now" hint={`When ${firstName}'s class work shows a topic is hard and the teacher has approved questions for it, it will appear here.`}/>
        : <ul className="practice-topics">{topics.map(t => <li key={t.indicatorId}>
          <div><strong>{t.topic}</strong><span className="sub">{t.subject}</span>
            <span className="practice-meta"><Dots level={t.level} levels={t.levels}/> Level {t.level} of {t.levels}{t.sessionsThisWeek > 0 && <> · {times(t.sessionsThisWeek)} this week</>}{t.lastPracticedOn && <> · last practised {ago(t.lastPracticedOn)}</>}</span></div>
          {t.open ? <button disabled={busy === t.indicatorId} onClick={() => begin(t)}>Continue</button>
            : t.availableToday ? <button disabled={busy === t.indicatorId} onClick={() => begin(t)}>{t.lastPracticedOn ? 'Practise again' : 'Start'}</button>
            : <Pill tone="positive">Done for today</Pill>}
        </li>)}</ul>}
    </Card>
    {practised.length > 0 && <Card title="Earlier practice">
      <ul className="practice-topics">{practised.map(p => <li key={p.indicatorId}>
        <div><strong>{p.topic}</strong><span className="sub">{p.subject}</span>
          <span className="practice-meta">{p.done ? <Pill tone="positive">Finished all levels</Pill> : <><Dots level={p.level} levels={p.levels}/> Level {p.level} of {p.levels}</>} · {times(p.sessionsThisWeek)} this week · last practised {ago(p.lastPracticedOn)}</span></div>
      </li>)}</ul>
    </Card>}
    {session && <PracticeSession base={base} csrfToken={csrfToken} firstName={firstName} start={session.view} onClose={() => { setSession(null); void load(); }}/>}
  </section>;
}

// One session, a question at a time: choose or type, check, see the right answer and why, then on to the next.
function PracticeSession({ base, csrfToken, firstName, start, onClose }: { base: string; csrfToken: string; firstName: string; start: View; onClose: () => void }) {
  const [view, setView] = useState<View>(start); const [result, setResult] = useState<Result | null>(null); const [chosen, setChosen] = useState<number | null>(null); const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const q = view.next, summary = result?.summary ?? view.summary;
  const check = (e: FormEvent) => { e.preventDefault(); if (!q) return; setBusy(true); setError('');
    request<Result>(`${base}/sessions/${view.sessionId}/answer`, { method: 'POST', headers: { 'x-csrf-token': csrfToken },
      body: JSON.stringify({ operationId: crypto.randomUUID(), questionId: q.questionId, ...(q.kind === 'choice' ? { choice: chosen } : { value: typed }) }) })
      .then(setResult).catch(err => setError((err as Error).message)).finally(() => setBusy(false)); };
  const next = () => { setBusy(true); setError('');
    request<View>(`${base}/sessions/${view.sessionId}`).then(v => { setView(v); setResult(null); setChosen(null); setTyped(''); }).catch(err => setError((err as Error).message)).finally(() => setBusy(false)); };
  const answeredNow = result ? result.answered : view.answered;
  return <Dialog title={`Practice: ${view.topic}`} onClose={onClose}>
    <div className="practice-session">
      <p className="practice-progress" aria-live="polite">{summary ? 'All done' : `Question ${Math.min(answeredNow + (result ? 0 : 1), view.total)} of ${view.total}`} · Level {view.level}</p>
      <div className="practice-bar" aria-hidden="true"><span style={{ width: `${Math.round(answeredNow * 100 / view.total)}%` }}/></div>
      {error && <p role="alert">{error}</p>}
      {result && q && <div className={`practice-feedback ${result.correct ? 'right' : 'wrong'}`} role="status">
        <strong><Icon name={result.correct ? 'check_circle' : 'info'}/>{result.correct ? 'Correct!' : 'Not quite.'}</strong>
        {!result.correct && <p>The answer is <strong>{q.kind === 'choice' ? q.options![result.correctOption!] : result.correctNumber}</strong>.</p>}
        {result.explanation && <p>{result.explanation}</p>}
      </div>}
      {!result && q && <form onSubmit={check} className="practice-question">
        <p className="practice-prompt">{q.prompt}</p>
        {q.kind === 'choice'
          ? <div className="practice-options" role="group" aria-label="Choose an answer">{q.options!.map((o, i) => <button type="button" key={i} aria-pressed={chosen === i} className={chosen === i ? 'chosen' : ''} onClick={() => setChosen(i)}>{o}</button>)}</div>
          : <label>Type your answer (a number)<input inputMode="decimal" autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} placeholder="e.g. 12 or 0.5" autoFocus/></label>}
        <div className="actions"><button disabled={busy || (q.kind === 'choice' ? chosen === null : !typed.trim())}>Check answer</button></div>
      </form>}
      {result && !result.summary && <div className="actions"><button disabled={busy} onClick={next}>Next question</button></div>}
      {summary && <div className="practice-summary">
        <h4>{summary.correct} of {summary.total} correct</h4>
        <p>{summary.outcome === 'up' ? `Well done! ${firstName} moves up to Level ${summary.levelAfter}.`
          : summary.outcome === 'done' ? `Brilliant! ${firstName} has finished every level for this topic.`
          : summary.outcome === 'down' ? `Let's build up again from Level ${summary.levelAfter}. Every try helps.`
          : `Good try. Keep practising at Level ${summary.levelAfter}.`}</p>
        <div className="actions"><button onClick={onClose}>Finish</button></div>
      </div>}
    </div>
  </Dialog>;
}
