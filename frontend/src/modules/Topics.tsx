import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';
import { AiLabel, Card, Dialog, Empty, Icon, PageHeader, Pill, Stat, when } from '../lib/ui';

type Content = { lesson: boolean; levels: number[]; target: number; openFlags: number };
type Approval = { id: string; grade: string; approvedByName: string; approvedAt: string; content: Content };
type Topic = { indicatorId: string; subject: string; code: string | null; description: string; grade: string | null; approvals: Approval[] };
type Term = { id: string; name: string; yearName: string; startDate: string; endDate: string; current: boolean };
type Overview = { terms: Term[]; term: Term & { ended: boolean }; gradeChoices: string[]; canApprove: boolean; target: number; openFlags: number; topics: Topic[] };
type Made = { generated: boolean; note: string | null; lesson: string; levels: { level: number; added: number; total: number }[] };
type Question = { id: string; level: number; kind: 'choice' | 'number'; prompt: string; options: string[] | null; correctOption: number | null; answer: number | null; explanation: string | null; retired: { cause: string; reason: string } | null };
type Lesson = { goal: string; steps: { heading: string; text: string }[]; example: { problem: string; working: string }; recap: string[] };
type Detail = { label: string; indicator: { subject: string; description: string }; grade: string; lesson: { id: string; body: Lesson } | null; questions: Question[]; flags: { questionId: string; handledAt: string | null }[] };
type Report = { id: string; reason: string; note: string | null; createdAt: string; question: Question & { source: string }; topic: { subject: string; description: string; grade: string | null } };
type Step = { approvalId: string; label: string; state: 'waiting' | 'making' | 'done' | 'problem'; detail: string };
type AiState = { enabled: boolean; platformEnabled: boolean; providerConfigured: boolean };

const reasons: Record<string, string> = { wrong_answer: 'The answer looks wrong', unclear: 'The question is unclear', not_taught: 'Not what the class learned', other: 'Another reason' };
const notes: Record<string, string> = {
  ai_disabled_platform: 'Claude is not switched on for the platform yet.', ai_disabled_school: 'AI assistance is off for this school. Switch it on in Settings, under AI assistance.',
  no_provider: 'No AI provider is set up yet.', monthly_cap_reached: "This month's AI limit for the school has been reached.", provider_error: 'Claude did not answer. Try again in a moment.',
  partial: 'Some questions were left out by the automatic checks. Make more to fill the gap.', topic_unavailable: 'This topic was retired, or is no longer one of your classes, while it was being made.', nothing_new: 'Nothing new could be made this time. Try again.',
  already_running: 'This topic is already being made. Give it a minute.', level_full: 'A level has used all its places for questions. Retire the topic and approve it again to start a fresh set.',
};
const explain = (note: string | null) => !note ? '' : notes[note] ?? (note.startsWith('rejected:') ? "Claude's answer did not pass the checks. Try again." : 'Nothing was made this time.');
const complete = (c: Content) => c.lesson && c.levels.every(n => n >= c.target);
const summary = (c: Content) => complete(c) ? `Lesson and ${c.target} questions at each level` : `${c.lesson ? 'Lesson ready' : 'No lesson yet'} · questions ${c.levels.join(' / ')} (aim ${c.target} each)`;

async function inPool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) await work(items[next++]!); }));
}

// A short reason is asked for before anything is retired; it is kept with who retired it.
function Retire({ label, confirm = 'Retire now', onRetire }: { label: string; confirm?: string; onRetire: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (!open) return <button type="button" className="secondary small" onClick={() => setOpen(true)}>{label}</button>;
  const submit = (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); onRetire(reason.trim()).then(() => setOpen(false)).catch(err => setError((err as Error).message)).finally(() => setBusy(false)); };
  return <form className="retire-form" onSubmit={submit}>
    <label>Why? (kept with your name)<input value={reason} minLength={3} maxLength={300} required autoFocus onChange={e => setReason(e.target.value)} placeholder="A few words"/></label>
    <div className="actions"><button className="small" disabled={busy || reason.trim().length < 3}>{confirm}</button><button type="button" className="secondary small" onClick={() => setOpen(false)}>Cancel</button></div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

function QuestionBody({ q }: { q: Question }) {
  return <>
    <strong className="q-prompt">{q.prompt}</strong>
    {q.kind === 'choice' ? <ul className="q-options">{q.options!.map((o, j) => <li key={j} className={j === q.correctOption ? 'right' : ''}><Icon name={j === q.correctOption ? 'check_circle' : 'radio_button_unchecked'}/><span>{o}{j === q.correctOption && <span className="sr-only"> (correct)</span>}</span></li>)}</ul>
      : <span className="q-number">Number answer: <strong>{q.answer}</strong></span>}
    {q.explanation && <span className="sub q-why">Why: {q.explanation}</span>}
  </>;
}

// Everything Claude made for one topic and class level, readable at any time: the lesson, then every question with its answer.
function TopicContent({ schoolId, csrfToken, topic, approval, term, canMake, onMake, onClose, onChanged }: { schoolId: string; csrfToken: string; topic: Topic; approval: Approval; term: string; canMake: boolean;
  onMake: () => void; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null); const [error, setError] = useState('');
  const base = `/schools/${schoolId}/learning`;
  const load = () => request<Detail>(`${base}/topics/${topic.indicatorId}/content?grade=${encodeURIComponent(approval.grade)}`).then(setDetail).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, [topic.indicatorId, approval.grade]);
  const retire = (path: string) => async (reason: string) => { await request(`${base}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), reason }) }); await load(); onChanged(); };
  const reported = new Set((detail?.flags ?? []).filter(f => !f.handledAt).map(f => f.questionId));
  const levels = [[1, 'Level 1', 'easiest'], [2, 'Level 2', 'middle'], [3, 'Level 3', 'hardest']] as const;
  return <Dialog title={topic.description} onClose={onClose} drawer>
    <p className="muted">{topic.subject}{topic.code ? ` · ${topic.code}` : ''} · {approval.grade} · approved by {approval.approvedByName}, {when(approval.approvedAt)}</p>
    <AiLabel text={detail?.label}/>
    {error && <p role="alert">{error}</p>}{!detail && !error && <p role="status">Loading…</p>}
    {detail && <>
      <div className="actions">
        {canMake && !complete(approval.content) && <button type="button" onClick={onMake}><Icon name="auto_awesome"/>Make the missing lesson and questions</button>}
        <Retire label="Retire this topic" confirm="Retire the topic" onRetire={async reason => { await request(`${base}/approvals/${approval.id}/retire`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), reason }) }); onChanged(); onClose(); }}/>
      </div>
      <p className="field-hint muted">Retiring the topic for {term} stops more being made. What exists is kept, and approving the topic again brings it back.</p>
      <Card title="Lesson" hint="What a child reads before practising.">
        {detail.lesson ? <div className="guide">
          <p><strong>{detail.lesson.body.goal}</strong></p>
          <ol className="lesson-steps">{detail.lesson.body.steps.map((s, i) => <li key={i}><strong>{s.heading}</strong><p>{s.text}</p></li>)}</ol>
          <div className="lesson-example"><strong>Worked example</strong><p>{detail.lesson.body.example.problem}</p><p>{detail.lesson.body.example.working}</p></div>
          <p><strong>Remember</strong></p><ul>{detail.lesson.body.recap.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <Retire label="Retire this lesson" onRetire={retire(`/lessons/${detail.lesson.id}/retire`)}/>
        </div> : <p className="muted">There is no current lesson. {canMake ? 'Use "Make the missing lesson and questions" to write one.' : ''}</p>}
      </Card>
      <Card title="Practice questions" hint="The right answer is ticked. A retired question is kept on this page and is never given to a child again.">
        <div className="question-bank">
          {levels.map(([level, name, hint]) => { const items = detail.questions.filter(q => q.level === level), live = items.filter(q => !q.retired).length;
            return <details key={level} open={level === 1}><summary><strong>{name}</strong> <span className="muted">{hint} · {live} in use{items.length > live ? ` · ${items.length - live} retired` : ''}</span></summary>
              {!items.length ? <p className="muted">No questions yet.</p> : <ol className="q-list">{items.map(q => <li key={q.id} className={q.retired ? 'retired' : ''}>
                <QuestionBody q={q}/>
                {q.retired ? <span><Pill tone="neutral">Retired</Pill> <span className="muted">{q.retired.cause === 'flag' ? q.retired.reason : `${q.retired.cause === 'check' ? 'By the automatic checks' : 'By a teacher'}: ${q.retired.reason}`}</span></span>
                  : <>{reported.has(q.id) && <Pill tone="critical">Reported by a parent</Pill>}<Retire label="Retire" onRetire={retire(`/questions/${q.id}/retire`)}/></>}
              </li>)}</ol>}
            </details>; })}
        </div>
      </Card>
    </>}
  </Dialog>;
}

// The term's topics: approve them once, and Claude makes the lessons and questions. Teachers see the class levels they teach; the head sees all.
export function Topics({ schoolId, csrfToken }: { schoolId: string; csrfToken: string; role: string }) {
  const [data, setData] = useState<Overview | null>(null); const [reports, setReports] = useState<Report[]>([]); const [ai, setAi] = useState<AiState | null>(null);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [subject, setSubject] = useState(''); const [grade, setGrade] = useState('');
  const [approving, setApproving] = useState(false); const [chosenGrade, setChosenGrade] = useState(''); const [steps, setSteps] = useState<Step[] | null>(null);
  const [open, setOpen] = useState<{ topic: Topic; approval: Approval } | null>(null);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const base = `/schools/${schoolId}`;
  const load = async (termId?: string) => {
    try {
      const [overview, flags] = await Promise.all([request<Overview>(`${base}/learning/topics${termId ? `?termId=${termId}` : ''}`), request<{ items: Report[] }>(`${base}/learning/flags`)]);
      if (!alive.current) return; setData(overview); setReports(flags.items); setError('');
    } catch (e) { if (alive.current) setError((e as Error).message); }
  };
  useEffect(() => { void load(); void request<AiState>(`${base}/ai/settings`).then(setAi).catch(() => undefined); }, [schoolId]);
  const send = <T,>(path: string, body: object) => request<T>(`${base}${path}`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  const aiReady = !!ai && ai.enabled && ai.platformEnabled && ai.providerConfigured;
  const aiWhy = !ai ? '' : !ai.platformEnabled ? notes.ai_disabled_platform! : !ai.enabled ? notes.ai_disabled_school! : !ai.providerConfigured ? notes.no_provider! : '';

  // Claude makes what is missing for each topic, two at a time. Closing the page does not lose anything: asking again makes only what is missing.
  async function make(items: { approvalId: string; label: string }[]) {
    if (!items.length) return;
    setSteps(items.map(i => ({ ...i, state: 'waiting' as const, detail: '' })));
    const patch = (approvalId: string, change: Partial<Step>) => alive.current && setSteps(list => list && list.map(s => s.approvalId === approvalId ? { ...s, ...change } : s));
    await inPool(items, 2, async item => {
      patch(item.approvalId, { state: 'making' });
      try {
        const r = await request<Made>(`${base}/learning/approvals/${item.approvalId}/generate`, { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
        const done = r.levels.map(l => l.total).join(' · ');
        patch(item.approvalId, r.note === 'already_running' ? { state: 'done', detail: 'Already being made' } : r.note && !r.generated ? { state: 'problem', detail: explain(r.note) } : { state: 'done', detail: r.generated ? `Questions ${done}${r.note ? `. ${explain(r.note)}` : ''}` : 'Already complete' });
      } catch (e) { patch(item.approvalId, { state: 'problem', detail: (e as Error).message }); }
    });
    await load(data?.term.id);
  }

  const approve = async (e: FormEvent) => {
    e.preventDefault(); if (!data) return; setBusy(true); setError('');
    try {
      const chosen = data.topics.filter(t => picked.has(t.indicatorId));
      const r = await send<{ approved: { approvalId: string; indicatorId: string; grade: string }[]; alreadyApproved: number }>('/learning/topics/approve', { termId: data.term.id, items: chosen.map(t => ({ indicatorId: t.indicatorId, ...(t.grade ? {} : { grade: chosenGrade }) })) });
      setApproving(false); setPicked(new Set());
      setMessage(`${r.approved.length} topic${r.approved.length === 1 ? '' : 's'} approved for ${data.term.name}.${aiReady ? '' : ` ${aiWhy || 'Nothing is made until AI assistance is on.'}`}`);
      await load(data.term.id);
      if (aiReady) void make(r.approved.map(a => ({ approvalId: a.approvalId, label: data.topics.find(t => t.indicatorId === a.indicatorId)?.description ?? 'Topic' })));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const handle = (id: string, outcome: 'was_wrong' | 'was_fine') => { setBusy(true); send(`/learning/flags/${id}/handle`, { outcome }).then(() => load(data?.term.id)).catch(e => setError((e as Error).message)).finally(() => setBusy(false)); };

  if (!data) return <>{<PageHeader eyebrow="Teaching" title="Topics" blurb="Approve what your classes learn this term."/>}{error ? <p role="alert">{error}</p> : <p role="status">Loading…</p>}</>;
  const subjects = [...new Set(data.topics.map(t => t.subject))], grades = [...new Set(data.topics.flatMap(t => [t.grade, ...t.approvals.map(a => a.grade)]).filter((g): g is string => !!g))].sort();
  const shown = data.topics.filter(t => (!subject || t.subject === subject) && (!grade || t.grade === grade || t.approvals.some(a => a.grade === grade)));
  const approvedCount = data.topics.filter(t => t.approvals.length).length, unapprovedShown = shown.filter(t => !t.approvals.length);
  const pickedTopics = data.topics.filter(t => picked.has(t.indicatorId)), needsGrade = pickedTopics.some(t => !t.grade);
  const toggle = (id: string) => setPicked(set => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const canPick = data.canApprove && !data.term.ended;

  return <section aria-label="Topics" className="page">
    <PageHeader eyebrow="Teaching" title="Topics" blurb="Approve what your classes learn this term. Claude then writes a lesson and practice questions from each approved topic, and you can read or retire anything it makes."
      actions={<label className="inline-field">Term<select value={data.term.id} onChange={e => { setPicked(new Set()); void load(e.target.value); }}>{data.terms.map(t => <option key={t.id} value={t.id}>{t.name} · {t.yearName}{t.current ? ' (now)' : ''}</option>)}</select></label>}/>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {ai && !aiReady && <p className="draft-banner" role="status"><span>{aiWhy} Approving topics still records them; nothing is made until it is on.</span></p>}
    <div className="stats">
      <Stat label="Topics approved" value={approvedCount} caption={`of ${data.topics.length} for ${data.term.name}`} icon="checklist" tone="positive"/>
      <Stat label="Reported by parents" value={reports.length} caption={reports.length ? 'Needs a look' : 'Nothing waiting'} icon="flag" tone={reports.length ? 'critical' : 'neutral'}/>
    </div>

    {steps && <Card title="Making lessons and questions" hint="Keep this page open until it finishes. Each topic takes about half a minute." action={steps.every(s => s.state === 'done' || s.state === 'problem') ? <button className="secondary small" onClick={() => setSteps(null)}>Close</button> : undefined}>
      <ul className="make-progress">{steps.map(s => <li key={s.approvalId}><Icon name={s.state === 'done' ? 'check_circle' : s.state === 'problem' ? 'error' : s.state === 'making' ? 'autorenew' : 'schedule'}/><strong>{s.label}</strong>
        <span className="muted">{s.state === 'waiting' ? 'Waiting' : s.state === 'making' ? 'Making…' : s.detail}</span></li>)}</ul>
    </Card>}

    {reports.length > 0 && <Card title={`Reported by parents (${reports.length})`} hint="A reported question has already stopped being given. Say whether the parent was right; the question stays retired either way.">
      <ul className="entries">{reports.map(r => <li key={r.id}>
        <div className="entry-main"><strong>{r.topic.description}</strong><span className="muted">{r.topic.subject}{r.topic.grade ? ` · ${r.topic.grade}` : ''} · {reasons[r.reason]} · {when(r.createdAt)}</span>
          <QuestionBody q={r.question}/>{r.note && <span className="sub">Parent wrote: “{r.note}”</span>}</div>
        <div className="entry-side"><button className="small" disabled={busy} onClick={() => handle(r.id, 'was_wrong')}>It was wrong</button><button className="secondary small" disabled={busy} onClick={() => handle(r.id, 'was_fine')}>It was fine</button></div>
      </li>)}</ul>
    </Card>}

    <Card title={`Topics for ${data.term.name}`} hint={data.term.ended ? 'This term has ended. You can read what was made but not approve more.' : 'Tick the topics your class is learning this term, then approve them. This is the only approval.'} flush>
      <div className="toolbar">
        <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Class<select value={grade} onChange={e => setGrade(e.target.value)}><option value="">All classes</option>{grades.map(g => <option key={g}>{g}</option>)}</select></label>
        {canPick && unapprovedShown.length > 0 && <button type="button" className="secondary small" onClick={() => setPicked(new Set(unapprovedShown.map(t => t.indicatorId)))}>Select all {unapprovedShown.length} not yet approved</button>}
        <span className="count">{shown.length} topic{shown.length === 1 ? '' : 's'}</span>
      </div>
      {picked.size > 0 && <p className="draft-banner"><span>{picked.size} topic{picked.size === 1 ? '' : 's'} selected</span>
        <span className="row-actions"><button className="small" onClick={() => { setChosenGrade(data.gradeChoices.length === 1 ? data.gradeChoices[0]! : ''); setApproving(true); }}>Approve for {data.term.name}</button><button className="secondary small" onClick={() => setPicked(new Set())}>Clear</button></span></p>}
      {!data.topics.length ? <Empty title="No topics yet" hint="The head adds the school's curriculum topics under Settings, Curriculum, with where they come from. They appear here to approve."/>
        : !shown.length ? <Empty title="No topics match" hint="Choose another subject or class."/>
        : <ul className="entries">{shown.flatMap(t => t.approvals.length ? t.approvals.map(a => ({ t, a })) : [{ t, a: null as Approval | null }]).map(({ t, a }) => <li key={`${t.indicatorId}:${a?.id ?? 'new'}`}>
          {a ? <div className="entry-main topic-pick static"><span className="topic-mark"><Icon name="check_circle"/></span><span className="topic-text"><strong>{t.description}</strong><span className="muted">{t.subject}{t.code ? ` · ${t.code}` : ''} · {a.grade}</span></span></div>
            : <label className="entry-main topic-pick"><input type="checkbox" disabled={!canPick} checked={picked.has(t.indicatorId)} onChange={() => toggle(t.indicatorId)} aria-label={`Select ${t.description}`}/>
              <span className="topic-text"><strong>{t.description}</strong><span className="muted">{t.subject}{t.code ? ` · ${t.code}` : ''}{t.grade ? ` · ${t.grade}` : ' · any class'}</span></span></label>}
          <div className="entry-side">
            {a ? <>
              <Pill tone="positive">Approved</Pill>
              {a.content.openFlags > 0 && <Pill tone="critical">{a.content.openFlags} reported</Pill>}
              <span className="muted">{summary(a.content)}</span>
              {!complete(a.content) && aiReady && <button className="small" disabled={!!steps && steps.some(s => s.state === 'making' || s.state === 'waiting')} onClick={() => void make([{ approvalId: a.id, label: t.description }])}>Make lessons and questions</button>}
              <button className="secondary small" onClick={() => setOpen({ topic: t, approval: a })}>Open</button>
            </> : <Pill tone="neutral">Not approved</Pill>}
          </div>
        </li>)}</ul>}
    </Card>

    {approving && <Dialog title={`Approve topics for ${data.term.name}`} onClose={() => setApproving(false)}>
      <form onSubmit={approve}>
        <p>{pickedTopics.length === 1 ? 'For this topic' : `For each of these ${pickedTopics.length} topics`}, Claude will write a short lesson and up to {data.target} practice questions at each of three levels. It is sent the topic's wording, its subject, the class level and the questions already written for the topic. Nothing about any child or any member of staff is sent.</p>
        <ul>{pickedTopics.slice(0, 8).map(t => <li key={t.indicatorId}>{t.description} <span className="muted">· {t.subject}</span></li>)}{pickedTopics.length > 8 && <li className="muted">and {pickedTopics.length - 8} more</li>}</ul>
        <p className="muted">Children are only taught inside approved topics. You can read everything Claude makes, retire any lesson or question at any time, and a parent can report a question that looks wrong.</p>
        {needsGrade && <label>Class these topics are for<select value={chosenGrade} required onChange={e => setChosenGrade(e.target.value)}><option value="">Choose a class</option>{data.gradeChoices.map(g => <option key={g}>{g}</option>)}</select></label>}
        {!aiReady && aiWhy && <p className="draft-banner" role="status"><span>{aiWhy} The topics will be recorded; nothing is made yet.</span></p>}
        <div className="actions"><button disabled={busy || (needsGrade && !chosenGrade)}>Approve {pickedTopics.length} topic{pickedTopics.length === 1 ? '' : 's'}</button><button type="button" className="secondary" onClick={() => setApproving(false)}>Cancel</button></div>
      </form>
    </Dialog>}
    {open && <TopicContent key={open.approval.id} schoolId={schoolId} csrfToken={csrfToken} topic={open.topic} approval={open.approval} term={data.term.name} canMake={aiReady}
      onMake={() => { const { topic, approval } = open; setOpen(null); void make([{ approvalId: approval.id, label: topic.description }]); }} onClose={() => setOpen(null)} onChanged={() => void load(data.term.id)}/>}
  </section>;
}
