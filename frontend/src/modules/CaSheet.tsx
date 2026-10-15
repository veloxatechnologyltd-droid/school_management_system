import React, { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { Card, Empty, Pill } from '../lib/ui';
import { caPartLabels } from '../lib/caParts';

type Part = typeof caPartLabels[number][0];
type Counts = Record<Part, number>;
type Sheet = {
  subject: { id: string; name: string };
  policy: { caWeight: number; examWeight: number; parts: Counts; sourceNote: string } | null;
  set: Counts; tests: { id: string; title: string; held_on: string; max_mark: number }[];
  items: { learnerId: string; fullName: string; left: boolean; locked: boolean; parts: Record<Part, { average: number | null; marked: number }>; tests: (number | null)[];
    ca: number | null; recordedCa: number | null; exam: number | null; total: number | null; gap: { direction: 'exam_higher' | 'exam_lower'; difference: number } | null }[];
};
type Workload = { asOf: string; items: ({ subjectId: string; name: string } & Record<'week' | 'month' | 'term', Counts>)[]; all: Record<'week' | 'month' | 'term', Counts> };

const round1 = (n: number) => Math.round(n * 10) / 10;
const CA_PART_KEYS = caPartLabels.map(([key]) => key);
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const tone = (n: number | null) => n === null ? '' : n >= 70 ? 'tone-positive' : n >= 50 ? 'tone-caution' : 'tone-critical';
const Pct = ({ value, sub }: { value: number | null; sub?: string }) => <>{value === null ? <span className="muted">–</span> : <strong className={tone(value)}>{value}</strong>}{sub && <span className="sub">{sub}</span>}</>;
const countText = (c: Counts) => caPartLabels.filter(([key]) => c[key]).map(([key, label]) => `${label} ${c[key]}`).join(' · ') || '–';

// The continuous assessment sheet for one subject, as a teacher keeps it on paper: each part of the CA with how many pieces
// of work were set, each class test on its own, the CA the parts make, the exam and the total. Class work far from the
// exam is marked for a closer look.
export function CaSheet({ schoolId, classId, termId, subjects, subjectId, onSubject, onLearner }: {
  schoolId: string; classId: string; termId: string; subjects: { id: string; name: string }[]; subjectId: string; onSubject: (id: string) => void; onLearner: (id: string) => void }) {
  const [sheet, setSheet] = useState<Sheet | null>(null); const [error, setError] = useState('');
  // With no subject chosen yet, open on the first subject that has class work this term.
  const [firstWithWork, setFirstWithWork] = useState<string | null>(null);
  useEffect(() => { let live = true; setFirstWithWork(null);
    if (!subjectId) request<Workload>(`/schools/${schoolId}/assessment/classes/${classId}/workload?termId=${termId}`)
      .then(r => { if (live) setFirstWithWork(r.items[0]?.subjectId ?? subjects[0]?.id ?? ''); }).catch(() => { if (live) setFirstWithWork(subjects[0]?.id ?? ''); });
    return () => { live = false; }; }, [schoolId, classId, termId, subjectId, subjects]);
  const subject = subjectId || firstWithWork || '';
  useEffect(() => { let live = true; setSheet(null); setError('');
    if (subject) request<Sheet>(`/schools/${schoolId}/assessment/classes/${classId}/ca-sheet?termId=${termId}&subjectId=${subject}`).then(r => { if (live) setSheet(r); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; }; }, [schoolId, classId, termId, subject]);

  const parts = sheet?.policy?.parts ?? { exercises: 30, homework: 30, tests: 40, projects: 0 };
  // Parts the school counts, or that have work set even though they count for nothing (shown so the teacher knows).
  const shown = caPartLabels.filter(([key]) => key !== 'tests' && (parts[key] || sheet?.set[key]));
  const testColumns = (sheet?.tests.length ?? 0) <= 4;
  const caWeight = sheet?.policy?.caWeight ?? null, examWeight = sheet?.policy?.examWeight ?? null;
  const rows = sheet?.items.filter(r => !r.left) ?? [];
  const flagged = rows.filter(r => r.gap);
  return <>
    <div className="toolbar"><label>Subject<select value={subject} onChange={e => onSubject(e.target.value)}>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {sheet?.policy && <span className="count">CA {sheet.policy.caWeight}% · Exam {sheet.policy.examWeight}% · CA made of {caPartLabels.filter(([key]) => parts[key]).map(([key, label]) => `${label.toLowerCase()} ${parts[key]}`).join(', ')}</span>}</div>
    {error && <p role="alert" className="card-body">{error}</p>}
    {!sheet ? !error && <p className="muted card-body" role="status">Loading…</p>
      : !sheet.policy ? <Empty title="No grading policy yet" hint="The headteacher sets the CA and exam weights, and the parts of the CA, in Settings."/>
      : !rows.length ? <Empty title="No learners in this class for the term"/>
      : <>
        <div className="table-wrap"><table className="ca-sheet"><thead><tr><th>Learner</th>
          {shown.map(([key, label]) => <th key={key} className="num">{label}<span className="sub">{parts[key] ? `${parts[key]} of CA` : 'not counted'} · {sheet.set[key]} set</span></th>)}
          {testColumns ? sheet.tests.map((t, i) => <th key={t.id} className="num">Test {i + 1}<span className="sub">{shortDate(t.held_on)} · {parts.tests && sheet.tests.length ? `${round1(parts.tests / sheet.tests.length)} of CA` : 'not counted'}</span></th>)
            : <th className="num">Class tests<span className="sub">{parts.tests} of CA · {sheet.tests.length} set</span></th>}
          <th className="num">CA<span className="sub">out of 100</span></th><th className="num">CA<span className="sub">{caWeight}%</span></th>
          <th className="num">Exam<span className="sub">out of 100</span></th><th className="num">Exam<span className="sub">{examWeight}%</span></th><th className="num">Total</th><th>Class work and exam</th></tr></thead>
          <tbody>{rows.map(r => { const caUsed = r.recordedCa ?? r.ca;
            return <tr key={r.learnerId}><td><button type="button" className="link-button" onClick={() => onLearner(r.learnerId)}>{r.fullName}</button>{r.locked && <span className="sub">Report published</span>}</td>
              {shown.map(([key]) => <td key={key} className="num"><Pct value={r.parts[key].average} sub={sheet.set[key] ? `${r.parts[key].marked} of ${sheet.set[key]}` : undefined}/></td>)}
              {testColumns ? r.tests.map((t, i) => <td key={i} className="num"><Pct value={t} sub={t === null ? 'no mark' : undefined}/></td>)
                : <td className="num"><Pct value={r.parts.tests.average} sub={`${r.parts.tests.marked} of ${sheet.tests.length}`}/></td>}
              <td className="num"><Pct value={r.ca} sub={r.recordedCa === null ? (r.ca === null ? undefined : 'not saved') : r.recordedCa !== r.ca ? `saved ${r.recordedCa}` : 'saved'}/></td>
              <td className="num">{caUsed === null || caWeight === null ? <span className="muted">–</span> : round1(caUsed * caWeight / 100)}</td>
              <td className="num"><Pct value={r.exam}/></td>
              <td className="num">{r.exam === null || examWeight === null ? <span className="muted">–</span> : round1(r.exam * examWeight / 100)}</td>
              <td className="num"><Pct value={r.total}/></td>
              <td>{r.gap ? <Pill tone={r.gap.direction === 'exam_higher' ? 'caution' : 'info'}>{`Exam ${Math.round(Math.abs(r.gap.difference))} pts ${r.gap.direction === 'exam_higher' ? 'higher' : 'lower'}`}</Pill>
                : r.exam === null ? <span className="muted">No exam yet</span> : CA_PART_KEYS.reduce((n, key) => n + r.parts[key].marked, 0) < 3 ? <span className="muted">Too little class work</span> : <span className="muted">In line</span>}</td></tr>; })}</tbody></table></div>
        <p className="muted card-body">CA comes from each learner's marks in each part, weighted as the school sets it. A part with no marks for a learner is left out and the others count for more, so check the "of" counts. The total uses the CA saved for the report card where there is one; save it on the Assessment page ("Fill CA from assessments").
          {' '}{flagged.length ? `${flagged.length} learner${flagged.length === 1 ? ' has' : 's have'}` : 'Nobody has'} an exam 20 or more points away from their class work (with at least 3 marks). That is worth a quiet look, for example a bad exam day, missed class work, or work done with help. It is not proof of anything.</p>
      </>}
  </>;
}

// How much class work each subject has had this week, this month and this term.
export function WorkSet({ schoolId, classId, termId, subjectId }: { schoolId: string; classId: string; termId: string; subjectId: string }) {
  const [load, setLoad] = useState<Workload | null>(null); const [error, setError] = useState('');
  useEffect(() => { let live = true; setLoad(null); setError('');
    request<Workload>(`/schools/${schoolId}/assessment/classes/${classId}/workload?termId=${termId}`).then(r => { if (live) setLoad(r); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; }; }, [schoolId, classId, termId]);
  const subject = subjectId;
  return <Card title="Work set" hint={load ? `Exercises (with quizzes), homework, class tests and projects given to this class, counted up to ${shortDate(load.asOf)}.` : undefined} flush>
      {error ? <p role="alert" className="card-body">{error}</p> : !load ? <p className="muted card-body" role="status">Loading…</p> : !load.items.length ? <Empty title="No class work recorded yet this term" hint="Add each exercise, homework or test on the Assessments tab."/>
        : <div className="table-wrap"><table><thead><tr><th>Subject</th><th>This week</th><th>This month</th><th>This term</th></tr></thead><tbody>
          {load.items.map(i => <tr key={i.subjectId} className={i.subjectId === subject ? 'selected' : undefined}><td>{i.name}</td><td>{countText(i.week)}</td><td>{countText(i.month)}</td><td>{countText(i.term)}</td></tr>)}
          <tr className="trend-total"><td>All subjects</td><td>{countText(load.all.week)}</td><td>{countText(load.all.month)}</td><td>{countText(load.all.term)}</td></tr></tbody></table></div>}
    </Card>;
}
