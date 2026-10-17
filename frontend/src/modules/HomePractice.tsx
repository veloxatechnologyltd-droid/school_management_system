import React, { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { AiLabel, Card, Dialog, Empty, Icon, Pill, Tabs, Tone, todayInAccra } from '../lib/ui';
import { FamilyHistory } from './LearningHistory';

type Standing = 'new' | 'doing_well' | 'getting_there' | 'needs_practice' | 'finished';
type Topic = { indicatorId: string; subject: string; topic: string; hasLesson: boolean; level: number; levels: number; sessionsThisWeek: number; lastPracticedOn: string | null;
  open: { sessionId: string; answered: number; total: number } | null; availableToday: boolean; done: boolean; standing: Standing; lastResult: { correct: number; total: number } | null; sessionsAll: number;
  onList?: boolean };
type Overview = { enabled: false } | { enabled: true; firstName: string; topics: Topic[]; subjects: { subject: string; topics: Topic[] }[] };
type Question = { questionId: string; position: number; kind: 'choice' | 'number'; prompt: string; options: string[] | null; madeByAi: boolean };
type Summary = { correct: number; total: number; outcome: 'up' | 'stay' | 'down' | 'done'; levelAfter: number };
type View = { sessionId: string; subject: string; topic: string; level: number; total: number; answered: number; next: Question | null; summary: Summary | null };
type Lesson = { goal: string; steps: { heading: string; text: string }[]; example: { problem: string; working: string }; recap: string[] };
type Study = { studySessionId: string; subject: string; topic: string; stage: 'lower_primary' | 'upper_primary' | 'jhs'; label: string; lessonId: string; lesson: Lesson };
type Result = { correct: boolean; correctOption: number | null; correctNumber: number | null; explanation: string | null; answered: number; total: number; summary: Summary | null };

const dayMs = 86400000;
export const ago = (iso: string) => { const n = Math.round((Date.parse(`${todayInAccra()}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / dayMs); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
export const times = (n: number) => n === 1 ? '1 session' : `${n} sessions`;
export const Dots = ({ level, levels }: { level: number; levels: number }) => <span className="level-dots" role="img" aria-label={`Level ${level} of ${levels}`}>{Array.from({ length: levels }, (_, i) => <span key={i} className={i < level ? 'on' : ''}/>)}</span>;

const standings: Record<Standing, { tone: Tone; text: string }> = {
  new: { tone: 'neutral', text: 'Not started' }, doing_well: { tone: 'positive', text: 'Doing well' }, getting_there: { tone: 'info', text: 'Getting there' },
  needs_practice: { tone: 'caution', text: 'Needs more practice' }, finished: { tone: 'positive', text: 'Finished all levels' },
};
// A subject at a glance: how many of this term's topics the child has started, and how many are going well or need help. Topics practised earlier but no longer listed do not count.
const summarise = (topics: Topic[]) => { const listed = topics.filter(t => t.onList !== false);
  return { listed, started: listed.filter(t => t.sessionsAll > 0).length, well: topics.filter(t => t.standing === 'doing_well' || t.standing === 'finished').length, help: topics.filter(t => t.standing === 'needs_practice').length }; };

// One subject's topics, each once, with how the child is doing. Topics practised earlier that the term's list no longer has stay visible below, without a way to start them.
function SubjectTopics({ subject, topics, firstName, row, onBack }: { subject: string; topics: Topic[]; firstName: string; row: (t: Topic, showSubject: boolean) => React.ReactNode; onBack: () => void }) {
  const { listed, started } = summarise(topics), earlier = topics.filter(t => t.onList === false);
  return <>
    <div className="actions"><button type="button" className="secondary" onClick={onBack}><Icon name="arrow_back"/>All subjects</button></div>
    <Card title={subject} hint={listed.length ? `${started} of ${listed.length} ${listed.length === 1 ? 'topic' : 'topics'} started. Pick any topic to study or practise: five questions at a time, at ${firstName}'s own level.` : `Topics ${firstName} practised earlier.`}>
      {listed.length > 0 && <ul className="practice-topics">{listed.map(t => row(t, false))}</ul>}
      {earlier.length > 0 && <><h4 className="topic-subject">Practised earlier</h4><ul className="practice-topics">{earlier.map(t => row(t, false))}</ul></>}
    </Card>
  </>;
}

// Practice at home: short sessions for a child on the topics class work shows are hardest, from questions a teacher approved.
// Families choose a subject, then a topic, and see the level reached, a word for how the last few sessions went and the last session's score out of five. Never class marks, percentages, ranks or other children.
export function HomePractice({ schoolId, csrfToken, childId }: { schoolId: string; csrfToken: string; childId: string }) {
  const [data, setData] = useState<Overview | null>(null); const [error, setError] = useState(''); const [session, setSession] = useState<{ topic: Topic; view: View } | null>(null); const [busy, setBusy] = useState(''); const [rev, setRev] = useState(0); const [tab, setTab] = useState<'practise' | 'back'>('practise'); const [subject, setSubject] = useState<string | null>(null);
  const base = `/schools/${schoolId}/guardian/children/${childId}/practice`;
  const load = () => request<Overview>(base).then(setData).catch(e => setError((e as Error).message));
  useEffect(() => { let live = true; setData(null); setError(''); request<Overview>(base).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [schoolId, childId]);
  const [study, setStudy] = useState<{ topic: Topic; lesson: Study } | null>(null);
  const studyBase = `/schools/${schoolId}/guardian/children/${childId}/study`;
  const begin = (topic: Topic, studySessionId?: string) => { setBusy(topic.indicatorId); setError('');
    return request<View>(`${base}/sessions`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), indicatorId: topic.indicatorId, ...(studySessionId ? { studySessionId } : {}) }) })
      .then(view => { setSession({ topic, view }); }).finally(() => setBusy('')); };
  const study_ = (topic: Topic) => { setBusy(topic.indicatorId); setError('');
    request<Study>(`${studyBase}/sessions`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), indicatorId: topic.indicatorId }) })
      .then(lesson => setStudy({ topic, lesson })).catch(e => { setError((e as Error).message); void load(); }).finally(() => setBusy('')); };
  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  if (!data.enabled) return <Card><Empty title="Practice at home is not switched on" hint="Your school has not turned on home practice yet. Ask the school if you would like it."/></Card>;
  // An API not yet updated sends no subjects or standings (the web app and the API deploy a few minutes apart): show what it does send rather than fail.
  const { firstName, topics } = data, subjects = data.subjects ?? [];
  const picked = subjects.find(s => s.subject === subject) ?? null;
  const begin_ = (t: Topic) => void begin(t).catch(e => { setError((e as Error).message); void load(); });
  const actions = (t: Topic) => {
    if (t.done || t.onList === false) return null;
    return <>{t.hasLesson && !t.open && t.availableToday && <button className="secondary" disabled={busy === t.indicatorId} onClick={() => study_(t)}>Study first</button>}
      {t.open ? <button disabled={busy === t.indicatorId} onClick={() => begin_(t)}>Continue</button>
        : t.availableToday ? <button disabled={busy === t.indicatorId} onClick={() => begin_(t)}>{t.lastPracticedOn ? 'Practise again' : 'Start practice'}</button>
        : <Pill tone="positive">Done for today</Pill>}</>;
  };
  // One topic: where the child is (level and how the last few sessions went), then what they can do next.
  const row = (t: Topic, showSubject: boolean) => { const how = t.standing ? standings[t.standing] : null; return <li key={t.indicatorId}>
    <div><strong>{t.topic}</strong>{showSubject && <span className="sub">{t.subject}</span>}
      <span className="practice-meta">{how && <Pill tone={how.tone}>{how.text}</Pill>}{!t.done && <><Dots level={t.level} levels={t.levels}/> Level {t.level} of {t.levels}</>}</span>
      {t.sessionsAll > 0 && <span className="practice-meta">{t.lastResult && <>Last time {t.lastResult.correct} of {t.lastResult.total} right · </>}{times(t.sessionsAll)} in all{t.sessionsThisWeek > 0 && <> · {t.sessionsThisWeek} this week</>}{t.lastPracticedOn && <> · last practised {ago(t.lastPracticedOn)}</>}</span>}</div>
    <div className="row-actions">{actions(t)}</div>
  </li>; };
  return <section aria-label="Practice at home" className="page">
    <div className="actions"><Tabs label="Learn at home" value={tab} onChange={setTab} options={[{ id: 'practise', label: 'Practise' }, { id: 'back', label: 'Looking back' }]}/></div>
    {error && <p role="alert">{error}</p>}
    {tab === 'practise' && (picked ? <SubjectTopics subject={picked.subject} topics={picked.topics} firstName={firstName} row={row} onBack={() => setSubject(null)}/> : <>
      {!topics.length && !subjects.length && <Card><Empty title="Nothing to practise right now" hint={`When the school has approved the term's topics, they will appear here by subject.`}/></Card>}
      {subjects.length > 0 && <Card title="Choose a subject" hint={`Pick a subject, then a topic ${firstName}'s class is learning this term. Practice is at ${firstName}'s own level and never changes class marks.`}>
        <div className="subject-grid">{subjects.map(s => { const { listed, started, well, help } = summarise(s.topics);
          return <button key={s.subject} type="button" className="subject-card" onClick={() => setSubject(s.subject)}>
            <span className="subject-name"><strong>{s.subject}</strong><Icon name="chevron_right"/></span>
            <span className="practice-bar" aria-hidden="true"><span style={{ width: `${listed.length ? Math.round(started * 100 / listed.length) : 0}%` }}/></span>
            <span className="practice-meta">{listed.length ? `${started} of ${listed.length} ${listed.length === 1 ? 'topic' : 'topics'} started` : 'Practised earlier'}</span>
            {(well > 0 || help > 0) && <span className="pill-row">{well > 0 && <Pill tone="positive">{well} doing well</Pill>}{help > 0 && <Pill tone="caution">{help} need{help === 1 ? 's' : ''} practice</Pill>}</span>}
          </button>; })}</div>
      </Card>}
      {topics.length > 0 && <Card title="Try these first" hint={`Topics ${firstName} could try next. The questions come from the school's own topics; the ones written by AI say so.`}>
        <ul className="practice-topics">{topics.map(t => row(t, true))}</ul>
      </Card>}
    </>)}
    {tab === 'back' && <FamilyHistory schoolId={schoolId} childId={childId} firstName={firstName} version={rev}/>}
    {study && <StudyLesson studyBase={studyBase} csrfToken={csrfToken} firstName={firstName} topic={study.topic} study={study.lesson} onClose={() => { setStudy(null); setRev(n => n + 1); void load(); }}
      onCheck={(studySessionId) => begin(study.topic,studySessionId).then(() => setStudy(null))}/>}
    {session && <PracticeSession base={base} csrfToken={csrfToken} firstName={firstName} start={session.view} onClose={() => { setSession(null); setRev(n => n + 1); void load(); }}/>}
  </section>;
}

// A parent can say a question looks wrong. It stops being given at once and the teacher is told, without learning which parent wrote.
const reportReasons = (what: 'question' | 'lesson') => [['wrong_answer', what === 'lesson' ? 'Something in it looks wrong' : 'The answer looks wrong'], ['unclear', what === 'lesson' ? 'The lesson is not clear' : 'The question is not clear'], ['not_taught', 'It is not what the class learned'], ['other', 'Something else']] as const;
function ReportQuestion({ url, csrfToken, what = 'question' }: { url: string; csrfToken: string; what?: 'question' | 'lesson' }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState<string>('wrong_answer'); const [note, setNote] = useState('');
  const [done, setDone] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (done) return <p role="status" className="report-done"><Icon name="check_circle"/>Thank you. We have told the teacher, and this {what} will not be shown again.</p>;
  if (!open) return <button type="button" className="secondary report-link" onClick={() => setOpen(true)}><Icon name="flag"/>This looks wrong</button>;
  const send = (e: FormEvent) => { e.preventDefault(); setBusy(true); setError('');
    request(url, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), reason, ...(note.trim() ? { note: note.trim() } : {}) }) })
      .then(() => setDone(true)).catch(err => setError((err as Error).message)).finally(() => setBusy(false)); };
  return <form className="report-form" onSubmit={send}>
    <label>What looks wrong?<select value={reason} onChange={e => setReason(e.target.value)}>{reportReasons(what).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
    <label>Anything to add? (optional)<input value={note} maxLength={300} onChange={e => setNote(e.target.value)}/></label>
    <div className="actions"><button disabled={busy}>Send to the teacher</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button></div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

// The lesson for a topic, on the parent's phone. JHS students get the whole lesson on one page; younger children read it one step at a time.
// At the end the child answers a short check (an ordinary practice session). Reading the lesson never changes class marks.
function StudyLesson({ studyBase, csrfToken, firstName, topic, study, onClose, onCheck }: { studyBase: string; csrfToken: string; firstName: string; topic: Topic; study: Study; onClose: () => void; onCheck: (studySessionId: string) => Promise<unknown> }) {
  const [at, setAt] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const { lesson } = study, whole = study.stage === 'jhs';
  const pages: { title: string; body: React.ReactNode }[] = [
    { title: 'What you will learn', body: <p className="study-goal">{lesson.goal}</p> },
    ...lesson.steps.map((s, i) => ({ title: s.heading, body: <p>{s.text}</p>, key: i })),
    { title: 'A worked example', body: <div className="lesson-example"><p>{lesson.example.problem}</p><p>{lesson.example.working}</p></div> },
    { title: 'Remember', body: <ul>{lesson.recap.map((r, i) => <li key={i}>{r}</li>)}</ul> },
  ];
  const check = () => { setBusy(true); setError('');
    request<{ finished: true; minutes: number }>(`${studyBase}/sessions/${study.studySessionId}/finish`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID() }) })
      .then(() => onCheck(study.studySessionId)).catch(e => { setError((e as Error).message); setBusy(false); }); };
  const checkButton = <button disabled={busy} onClick={check}>Check what you learned</button>;
  return <Dialog title={`Study: ${topic.topic}`} onClose={onClose}>
    <div className="practice-session study">
      <AiLabel text={study.label}/>
      {error && <p role="alert">{error}</p>}
      {whole ? <>
        <p className="study-goal">{lesson.goal}</p>
        {lesson.steps.map((s, i) => <section key={i} className="study-block"><h4>{s.heading}</h4><p>{s.text}</p></section>)}
        <section className="study-block"><h4>A worked example</h4><div className="lesson-example"><p>{lesson.example.problem}</p><p>{lesson.example.working}</p></div></section>
        <section className="study-block"><h4>Remember</h4><ul>{lesson.recap.map((r, i) => <li key={i}>{r}</li>)}</ul></section>
        <div className="actions">{checkButton}<button className="secondary" onClick={onClose}>Not now</button></div>
      </> : <>
        <p className="practice-progress" aria-live="polite">Step {at + 1} of {pages.length}</p>
        <div className="practice-bar" aria-hidden="true"><span style={{ width: `${Math.round((at + 1) * 100 / pages.length)}%` }}/></div>
        <section className="study-step"><h4>{pages[at]!.title}</h4>{pages[at]!.body}</section>
        <div className="actions">{at > 0 && <button className="secondary" onClick={() => setAt(at - 1)}>Back</button>}
          {at < pages.length - 1 ? <button onClick={() => setAt(at + 1)}>Next</button> : checkButton}</div>
      </>}
      <ReportQuestion url={`${studyBase}/lessons/${study.lessonId}/flag`} csrfToken={csrfToken} what="lesson"/>
      <p className="muted">{firstName}'s class marks do not change when {firstName} studies or practises here.</p>
    </div>
  </Dialog>;
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
      {q?.madeByAi && <AiLabel/>}
      {error && <p role="alert">{error}</p>}
      {result && q && <div className={`practice-feedback ${result.correct ? 'right' : 'wrong'}`} role="status">
        <strong><Icon name={result.correct ? 'check_circle' : 'info'}/>{result.correct ? 'Correct!' : 'Not quite.'}</strong>
        {!result.correct && <p>The answer is <strong>{q.kind === 'choice' ? q.options![result.correctOption!] : result.correctNumber}</strong>.</p>}
        {result.explanation && <p>{result.explanation}</p>}
      </div>}
      {result && q && <ReportQuestion key={q.questionId} url={`${base}/questions/${q.questionId}/flag`} csrfToken={csrfToken}/>}
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
