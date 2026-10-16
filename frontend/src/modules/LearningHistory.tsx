import React, { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { AiLabel, Card, Dialog, Empty, Icon } from '../lib/ui';

type Lesson = { goal: string; steps: { heading: string; text: string }[]; example: { problem: string; working: string }; recap: string[] };
type Question = { position: number; prompt: string; kind: 'choice' | 'number'; options: string[] | null; given: number | string; withdrawn: boolean; correct: boolean | null; correctOption: number | null; correctNumber: number | null; explanation: string | null };
type Practice = { kind: 'practice'; id: string; on: string; subject: string; topic: string; level: number; correct: number; total: number; madeByAi: boolean; label: string; questions: Question[] };
type Study = { kind: 'study'; id: string; on: string; subject: string; topic: string; label: string; withdrawn: boolean; lesson: Lesson | null; check: { sessionId: string; correct: number; total: number } | null; minutes?: number };
type Item = { kind: 'practice' | 'study'; id: string; on: string; subject: string; topic: string; level?: number; correct?: number; total?: number; check?: { correct: number; total: number } | null; afterStudy?: boolean };
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

// One lesson or one finished practice, in full: the words as they were shown, what the child chose, the right answer and why. Reading it changes nothing.
export function HistoryDialog({ base, start, who, onClose }: { base: string; start: { kind: 'practice' | 'study'; id: string }; who: string; onClose: () => void }) {
  const [at, setAt] = useState(start); const [data, setData] = useState<Practice | Study | null>(null); const [error, setError] = useState('');
  useEffect(() => { let live = true; setData(null); setError(''); request<Practice | Study>(`${base}/${at.kind}/${at.id}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [base, at.kind, at.id]);
  return <Dialog title={data?.topic ?? 'Looking back'} onClose={onClose}>
    <div className="history-entry">
      {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Loading…</p>}
      {data?.kind === 'practice' && <>
        <p className="muted">{data.subject} · {shortDate(data.on)} · Level {data.level} · {data.correct} of {data.total} right</p>
        {data.madeByAi && <AiLabel text={data.label}/>}
        <ol className="history-questions">{data.questions.map(q => <li key={q.position}>
          <p className="history-prompt">{q.prompt}</p>
          {q.kind === 'choice'
            ? <ul className="history-options">{q.options!.map((o, i) => { const mine = q.given === i, right = !q.withdrawn && q.correctOption === i;
              return <li key={i} className={`${mine ? 'mine' : ''} ${right ? 'right' : ''}`.trim()}><span>{o}</span>
                {(mine || right) && <span className="history-tag">{mine && `${who}'s answer`}{mine && right && ' · '}{right && <><Icon name="check_circle"/>Right answer</>}</span>}</li>; })}</ul>
            : <p>{who} typed <strong>{q.given}</strong>{!q.withdrawn && <> · Right answer: <strong>{q.correctNumber}</strong></>}</p>}
          {q.withdrawn ? <p className="muted">This question was taken out by the school, so it was not marked.</p>
            : <p className={`history-verdict ${q.correct ? 'right' : 'wrong'}`}><strong>{q.correct ? 'Correct.' : 'Not quite.'}</strong>{q.explanation && <> {q.explanation}</>}</p>}
        </li>)}</ol>
      </>}
      {data?.kind === 'study' && <>
        <p className="muted">{data.subject} · {shortDate(data.on)}{data.minutes !== undefined && ` · open for ${data.minutes < 1 ? 'under a minute' : `${data.minutes} minute${data.minutes === 1 ? '' : 's'}`}`}</p>
        <AiLabel text={data.label}/>
        {data.withdrawn || !data.lesson ? <p className="muted">This lesson was taken out by the school, so it is no longer shown.</p> : <>
          <p className="study-goal">{data.lesson.goal}</p>
          {data.lesson.steps.map((s, i) => <section key={i} className="study-block"><h4>{s.heading}</h4><p>{s.text}</p></section>)}
          <section className="study-block"><h4>A worked example</h4><div className="lesson-example"><p>{data.lesson.example.problem}</p><p>{data.lesson.example.working}</p></div></section>
          <section className="study-block"><h4>Remember</h4><ul>{data.lesson.recap.map((r, i) => <li key={i}>{r}</li>)}</ul></section></>}
        {data.check && <div className="actions"><button className="secondary" onClick={() => setAt({ kind: 'practice', id: data.check!.sessionId })}>See the check: {data.check.correct} of {data.check.total} right</button></div>}
      </>}
      <div className="actions"><button className="secondary" onClick={onClose}>Close</button></div>
    </div>
  </Dialog>;
}

// The family's list: lessons the child read to the end and practice finished, newest first, each one to look at again.
export function FamilyHistory({ schoolId, childId, firstName, version }: { schoolId: string; childId: string; firstName: string; version: number }) {
  const base = `/schools/${schoolId}/guardian/children/${childId}/history`;
  const [data, setData] = useState<{ enabled: boolean; items: Item[] } | null>(null); const [error, setError] = useState(''); const [open, setOpen] = useState<Item | null>(null); const [all, setAll] = useState(false);
  useEffect(() => { let live = true; request<{ enabled: boolean; items: Item[] }>(base).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [base, version]);
  if (error) return <p role="alert">{error}</p>;
  if (!data || !data.enabled) return null;
  const shown = all ? data.items : data.items.slice(0, 5);
  return <Card title={`What ${firstName} has learned`} hint={`Lessons ${firstName} read and practice ${firstName} finished. Open any of them to see the lesson again, or the questions, the answers ${firstName} gave, and the right answers.`}>
    {!data.items.length ? <Empty title="Nothing here yet" hint="When a lesson is read to the end or a practice is finished, it appears here to look at again."/>
      : <ul className="history-list">{shown.map(i => <li key={`${i.kind}:${i.id}`}>
        <div><strong>{i.topic}</strong><span className="sub">{i.subject} · {shortDate(i.on)}</span>
          <span className="practice-meta"><Icon name={i.kind === 'study' ? 'menu_book' : 'edit_note'}/>{i.kind === 'study'
            ? <>Lesson read{i.check ? ` · check: ${i.check.correct} of ${i.check.total} right` : ''}</>
            : <>Practice · Level {i.level} · {i.correct} of {i.total} right</>}</span></div>
        <button className="secondary" onClick={() => setOpen(i)}>Look again</button>
      </li>)}</ul>}
    {data.items.length > 5 && <button type="button" className="link-button small-link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${data.items.length}`}</button>}
    {open && <HistoryDialog base={base} start={{ kind: open.kind, id: open.id }} who={firstName} onClose={() => setOpen(null)}/>}
  </Card>;
}
