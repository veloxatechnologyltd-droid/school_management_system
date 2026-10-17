import React, { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Pill, Stat } from '../lib/ui';
import { Dots, ago, times } from './HomePractice';
import { HistoryDialog } from './LearningHistory';

type Topic = { subject: string; topic: string; level: number; levels: number; done: boolean; sessions: number; sessionsThisWeek: number; lastPracticedOn: string };
type Study = { id: string; on: string; subject: string; topic: string; minutes: number; check: { correct: number; total: number } | null };
type LearnerView = { enabled: boolean; studies: Study[]; topics: Topic[]; recent: { id: string; on: string; subject: string; topic: string; level: number; correct: number; total: number; outcome: string; levelAfter: number }[]; unfinished: number };
type ClassView = { enabled: boolean; weekStart: string; practisingThisWeek: number; practisedThisTerm: number; total: number;
  learners: { learnerId: string; fullName: string; sessionsThisWeek: number; sessionsTerm: number; lastPracticedOn: string | null; topics: Topic[] }[] };
const outcomeWords: Record<string, string> = { up: 'moved up', stay: 'stayed', down: 'moved down', done: 'finished the topic' };
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const level = (t: Topic, extra?: string) => <span className="practice-meta">{t.done ? <Pill tone="positive">Finished</Pill> : <><Dots level={t.level} levels={t.levels}/> Level {t.level} of {t.levels}</>}{extra && <> · {extra}</>}</span>;

// What this child has practised at home. Evidence beside class work: it is never part of CA or report scores.
export function LearnerHomePractice({ schoolId, learnerId }: { schoolId: string; learnerId: string }) {
  const [data, setData] = useState<LearnerView | null>(null); const [error, setError] = useState(''); const [open, setOpen] = useState<{ kind: 'practice' | 'study'; id: string } | null>(null);
  useEffect(() => { let live = true; setData(null); setError(''); request<LearnerView>(`/schools/${schoolId}/learners/${learnerId}/practice`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [schoolId, learnerId]);
  if (error) return <Card title="Home practice"><p role="alert">{error}</p></Card>;
  if (!data) return null;
  const studies = data.studies ?? []; // an older server answers without it
  return <Card title="Home practice" hint="Lessons read and questions answered on a parent's phone. Evidence beside class work, never part of CA or report scores.">
    {!data.topics.length && !studies.length ? <p className="muted">{data.enabled ? 'Has not practised at home yet.' : 'Home practice is switched off for this school, and nothing has been practised.'}</p>
      : <>{studies.length > 0 && <><h4>Lessons studied</h4><ul className="plain-list">{studies.map((x, i) => <li key={i}>{shortDate(x.on)} · {x.topic} <span className="muted">{x.subject}</span>
          <span className="sub">{x.minutes < 1 ? 'Under a minute' : `${x.minutes} minute${x.minutes === 1 ? '' : 's'}`} reading · {x.check ? `check: ${x.check.correct} of ${x.check.total} right` : 'no check taken'}</span>
          <button type="button" className="link-button small-link" onClick={() => setOpen({ kind: 'study', id: x.id })}>Read the lesson</button></li>)}</ul></>}
        {data.topics.length > 0 && <><h4>Practised</h4><ul className="plain-list">{data.topics.map((t, i) => <li key={i}><strong>{t.topic}</strong> <span className="muted">{t.subject}</span>
        <span className="sub">{level(t, `${times(t.sessions)} · last practised ${ago(t.lastPracticedOn)}`)}</span></li>)}</ul></>}
        {data.recent.length > 0 && <h4>Recent sessions</h4>}
        <ul className="plain-list">{data.recent.map((r, i) => <li key={i}>{shortDate(r.on)} · {r.topic} <span className="sub">Level {r.level}: {r.correct} of {r.total} right, {outcomeWords[r.outcome]}{r.outcome === 'up' || r.outcome === 'down' ? ` to Level ${r.levelAfter}` : ''}</span>
          <button type="button" className="link-button small-link" onClick={() => setOpen({ kind: 'practice', id: r.id })}>Questions and answers</button></li>)}</ul>
        {data.unfinished > 0 && <p className="muted">{data.unfinished === 1 ? '1 session was started and not finished.' : `${data.unfinished} sessions were started and not finished.`}</p>}
        {!data.enabled && <p className="muted">Home practice is switched off for this school now.</p>}</>}
    {open && <HistoryDialog base={`/schools/${schoolId}/learners/${learnerId}/practice/history`} start={open} who="The student" onClose={() => setOpen(null)}/>}
  </Card>;
}

// A class's home practice this term: who has practised, on what topic at which level, and how recently.
export function ClassHomePractice({ schoolId, classId, termId, earlyYears = false }: { schoolId: string; classId: string; termId: string; earlyYears?: boolean }) {
  const [data, setData] = useState<ClassView | null>(null); const [error, setError] = useState('');
  useEffect(() => { let live = true; setData(null); setError(''); request<ClassView>(`/schools/${schoolId}/assessment/classes/${classId}/home-practice?termId=${termId}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [schoolId, classId, termId]);
  if (earlyYears) return <Empty title="Home practice is for Primary and JHS" hint="It is built from class exercises, homework and tests, which Nursery and KG classes do not record. These children are not offered it."/>;
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.total) return <Empty title="No students in this class for the term"/>;
  return <>
    <div className="stats pad">
      <Stat label="Practising this week" value={`${data.practisingThisWeek} of ${data.total}`} caption={`Since Monday ${shortDate(data.weekStart)}`} icon="menu_book" tone={data.practisingThisWeek ? 'positive' : 'neutral'}/>
      <Stat label="Practised this term" value={`${data.practisedThisTerm} of ${data.total}`} caption="Students with at least one finished session" icon="history_edu"/>
    </div>
    {!data.enabled && <p className="muted pad">Home practice is switched off for this school. Turn it on in Settings, under Family sharing and home practice.</p>}
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Topics and levels</th><th className="hide-sm">Last practised</th></tr></thead><tbody>
      {[...data.learners].sort((a, b) => (b.lastPracticedOn ?? '').localeCompare(a.lastPracticedOn ?? '') || a.fullName.localeCompare(b.fullName)).map(l => <tr key={l.learnerId}>
        <td><a href={`#/learner/${l.learnerId}`}>{l.fullName}</a>{l.sessionsTerm > 0 && <span className="sub">Sessions: {l.sessionsThisWeek} this week, {l.sessionsTerm} this term</span>}{l.lastPracticedOn && <span className="sub show-sm">Last practised {ago(l.lastPracticedOn)}</span>}</td>
        <td>{!l.topics.length ? <span className="muted">Not yet</span> : <ul className="plain-list">{l.topics.map((t, i) => <li key={i} className="topic-level"><span>{t.topic}</span>{level(t)}</li>)}</ul>}</td>
        <td className="hide-sm">{l.lastPracticedOn ? ago(l.lastPracticedOn) : <span className="muted">–</span>}</td></tr>)}</tbody></table></div>
  </>;
}
