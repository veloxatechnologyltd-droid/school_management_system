import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import { Dialog, Empty, Pill, Tone, todayInAccra } from '../lib/ui';

type Owner = { membershipId: string; name: string; classTeacher: boolean };
type Evidence = { before: number | null; since: number | null; change: number | null; improved: number; dropped: number; compared: number };
export type Plan = { id: string; class_id: string; class_name: string; subject_name: string; indicator_code: string | null; indicator_description: string | null; concern: string; action: string;
  owner_name: string; start_date: string; review_date: string; closed: boolean; due: boolean; learners: { id: string; full_name: string }[]; evidence: Evidence };
type Detail = Plan & { subject_id: string; indicator_id: string | null; evidence: { upTo: string; learners: { learnerId: string; fullName: string; before: number | null; beforeMarks: number; since: number | null; sinceMarks: number; change: number | null }[]; group: Evidence };
  reviews: { id: string; reviewed_on: string; outcome: string; note: string; decision: string; next_review_date: string | null }[]; today: string };
export type PlanDraft = { subjectId: string; indicatorId?: string; indicatorLabel?: string; learnerIds: string[]; concern: string };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const actions = ['Re-teach in a small group', 'Extra practice exercises', 'One-to-one help during break', 'Pair with a peer helper', 'Practice at home with the guardian', 'Meet the guardian'];
const outcomes = [['improved', 'Improved', 'positive'], ['no_change', 'No change', 'caution'], ['worse', 'Worse', 'critical']] as const;
const signed = (n: number | null) => n === null ? '–' : `${n > 0 ? '+' : ''}${n}`;
const changeTone = (n: number | null): Tone => n === null ? 'neutral' : n >= 5 ? 'positive' : n <= -5 ? 'critical' : 'caution';
export const reviewPill = (p: Pick<Plan, 'closed' | 'due' | 'review_date'>, today: string) => p.closed ? <Pill>Closed</Pill>
  : p.due ? <Pill tone="critical">{p.review_date < today ? `Overdue · ${shortDate(p.review_date)}` : 'Review today'}</Pill> : <Pill tone="info">Review {shortDate(p.review_date)}</Pill>;

// New plan: prefilled from a flagged learner or a weak indicator; the teacher adds the action and when to review it.
export function SupportPlanDialog({ schoolId, csrfToken, classId, termId, draft, subjects, roster, onClose, onSaved }: { schoolId: string; csrfToken: string; classId: string; termId: string; draft: PlanDraft;
  subjects: { id: string; name: string }[]; roster: { learnerId: string; fullName: string }[]; onClose: () => void; onSaved: (id: string) => void }) {
  const today = todayInAccra();
  const [form, setForm] = useState({ ...draft, action: '', ownerMembershipId: '', startDate: today, reviewDate: addDays(today, 14) });
  const [owners, setOwners] = useState<Owner[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { request<{ items: Owner[] }>(`/schools/${schoolId}/support-plans/owners?classId=${classId}`).then(r => { setOwners(r.items); setForm(f => ({ ...f, ownerMembershipId: f.ownerMembershipId || r.items[0]?.membershipId || '' })); }).catch(e => setError((e as Error).message)); }, [schoolId, classId]);
  const toggle = (id: string) => setForm(f => ({ ...f, learnerIds: f.learnerIds.includes(id) ? f.learnerIds.filter(x => x !== id) : [...f.learnerIds, id] }));
  const addAction = (text: string) => setForm(f => ({ ...f, action: f.action.trim() ? `${f.action.trim().replace(/\.$/, '')}. ${text}.` : `${text}.` }));
  // Learners already chosen stay at the top, so the teacher sees who is in the plan without scrolling.
  const order = useMemo(() => [...roster].sort((a, b) => Number(draft.learnerIds.includes(b.learnerId)) - Number(draft.learnerIds.includes(a.learnerId))), [roster, draft.learnerIds]);
  const save = (e: FormEvent) => { e.preventDefault(); setBusy(true); setError('');
    request<{ id: string }>(`/schools/${schoolId}/assessment/classes/${classId}/support-plans`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), termId, subjectId: form.subjectId,
      ...(form.indicatorId ? { indicatorId: form.indicatorId } : {}), learnerIds: form.learnerIds, concern: form.concern, action: form.action, ownerMembershipId: form.ownerMembershipId || undefined, startDate: form.startDate, reviewDate: form.reviewDate }) })
      .then(r => onSaved(r.id)).catch(e => setError((e as Error).message)).finally(() => setBusy(false)); };
  return <Dialog title="Plan support" wide onClose={onClose}>
    <form onSubmit={save}>
      {error && <p role="alert">{error}</p>}
      {form.indicatorId && draft.indicatorLabel && <p className="muted">Topic: <strong>{draft.indicatorLabel}</strong></p>}
      <label>Subject<select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value, indicatorId: undefined })} required>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <fieldset className="indicator-picker"><legend>Learners ({form.learnerIds.length})</legend><div className="indicator-options">
        {order.map(l => <label key={l.learnerId} className="check"><input type="checkbox" checked={form.learnerIds.includes(l.learnerId)} onChange={() => toggle(l.learnerId)}/><span>{l.fullName}</span></label>)}</div></fieldset>
      <label>What we have noticed<textarea rows={2} value={form.concern} onChange={e => setForm({ ...form, concern: e.target.value })} required minLength={3} maxLength={500}/></label>
      <label>What we will do<textarea rows={2} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} required minLength={3} maxLength={500} placeholder="e.g. Re-teach fractions in a small group on Tuesdays and Thursdays"/></label>
      <div className="chip-row">{actions.map(a => <button key={a} type="button" className="chip" onClick={() => addAction(a)}>+ {a}</button>)}</div>
      <label>Responsible<select value={form.ownerMembershipId} onChange={e => setForm({ ...form, ownerMembershipId: e.target.value })} disabled={owners.length < 2}>{owners.map(o => <option key={o.membershipId} value={o.membershipId}>{o.name}{o.classTeacher ? ' (class teacher)' : ''}</option>)}</select></label>
      <div className="field-row"><label>Starts<input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} required/></label>
        <label>Review on<input type="date" value={form.reviewDate} min={addDays(form.startDate, 1)} onChange={e => setForm({ ...form, reviewDate: e.target.value })} required/></label></div>
      <button disabled={busy || !form.learnerIds.length}>Start the plan</button>
    </form>
  </Dialog>;
}

// One plan: the agreed action, each learner's marks before and since it began, earlier reviews, and the next review.
export function SupportPlanDrawer({ schoolId, csrfToken, planId, onClose, onChanged, onFollowUp }: { schoolId: string; csrfToken: string; planId: string; onClose: () => void; onChanged: () => void; onFollowUp?: (draft: PlanDraft & { classId: string }) => void }) {
  const [plan, setPlan] = useState<Detail | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [review, setReview] = useState({ outcome: '', note: '', decision: 'continue', nextReviewDate: '' });
  const load = () => request<Detail>(`/schools/${schoolId}/support-plans/${planId}`).then(p => { setPlan(p);
    // Suggest the outcome the marks point to; the teacher decides.
    const c = p.evidence.group.change; setReview(r => ({ ...r, outcome: c === null ? '' : c >= 5 ? 'improved' : c <= -5 ? 'worse' : 'no_change', nextReviewDate: addDays(p.today, 14) })); }).catch(e => setError((e as Error).message));
  useEffect(() => { void load(); }, [schoolId, planId]);
  const save = (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); setMessage('');
    request(`/schools/${schoolId}/support-plans/${planId}/reviews`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), outcome: review.outcome, note: review.note, decision: review.decision,
      ...(review.decision === 'continue' ? { nextReviewDate: review.nextReviewDate } : {}) }) })
      .then(async () => { setReview(r => ({ ...r, note: '' })); await load(); onChanged(); setMessage(review.decision === 'close' ? 'Plan closed.' : 'Review recorded.'); }).catch(e => setError((e as Error).message)).finally(() => setBusy(false)); };
  const today = plan?.today ?? todayInAccra();
  return <Dialog title={plan ? `Support: ${plan.subject_name}${plan.indicator_code || plan.indicator_description ? ` · ${plan.indicator_code ?? plan.indicator_description}` : ''}` : 'Support plan'} drawer onClose={onClose}>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {plan && <>
      <p>{reviewPill(plan, today)} <span className="muted">{plan.class_name} · started {shortDate(plan.start_date)} · {plan.owner_name}</span></p>
      <dl className="plan-facts"><div><dt>Noticed</dt><dd>{plan.concern}</dd></div><div><dt>Action</dt><dd>{plan.action}</dd></div></dl>
      <h4>Marks before the plan and since</h4>
      <div className="table-wrap"><table><thead><tr><th>Learner</th><th className="num">Before</th><th className="num">Since</th><th className="num">Change</th></tr></thead><tbody>
        {plan.evidence.learners.map(l => <tr key={l.learnerId}><td>{l.fullName}</td><td className="num">{l.before === null ? '–' : `${l.before}%`}<span className="sub">{l.beforeMarks} mark{l.beforeMarks === 1 ? '' : 's'}</span></td>
          <td className="num">{l.since === null ? '–' : `${l.since}%`}<span className="sub">{l.sinceMarks} mark{l.sinceMarks === 1 ? '' : 's'}</span></td><td className={`num tone-${changeTone(l.change)}`}>{signed(l.change)}</td></tr>)}
        <tr className="trend-total"><td>Group</td><td className="num">{plan.evidence.group.before ?? '–'}</td><td className="num">{plan.evidence.group.since ?? '–'}</td><td className={`num tone-${changeTone(plan.evidence.group.change)}`}>{signed(plan.evidence.group.change)}</td></tr></tbody></table></div>
      {!plan.evidence.learners.some(l => l.sinceMarks) && <p className="muted">No marks since the plan began yet. Record an assessment in this subject{plan.indicator_code || plan.indicator_description ? ', tagged with the indicator,' : ''} to see whether it is working.</p>}
      {onFollowUp && (() => {
        // Learners still below the pass line, or not better than before, can go straight into a new plan.
        const still = plan.evidence.learners.filter(l => (l.since ?? l.before ?? 0) < 50 || (l.change !== null && l.change <= 0));
        return still.length > 0 && <p className="follow-up"><span className="muted">{still.length} learner{still.length === 1 ? ' is' : 's are'} still below 50% or not improving.</span>
          <button type="button" className="secondary small" onClick={() => onFollowUp({ classId: plan.class_id, subjectId: plan.subject_id, indicatorId: plan.indicator_id ?? undefined, indicatorLabel: plan.indicator_code ?? plan.indicator_description ?? undefined, learnerIds: still.map(l => l.learnerId),
            concern: `Follow-up from the ${plan.subject_name}${plan.indicator_description ? ` (${plan.indicator_description})` : ''} plan started ${shortDate(plan.start_date)}: ${still.map(l => `${l.fullName} ${l.since ?? l.before ?? '–'}%`).join(', ')}.` })}>Follow-up plan</button></p>;
      })()}
      {plan.reviews.length > 0 && <><h4>Reviews</h4><ul className="history">{plan.reviews.map(r => <li key={r.id}><strong>{shortDate(r.reviewed_on)} · {outcomes.find(o => o[0] === r.outcome)?.[1]}</strong>
        <span>{r.note}{r.decision === 'close' ? ' · Plan closed' : r.next_review_date ? ` · Next review ${shortDate(r.next_review_date)}` : ''}</span></li>)}</ul></>}
      {!plan.closed && <form onSubmit={save} className="review-form"><h4>Record a review</h4>
        <fieldset className="choice-row"><legend>Outcome</legend>{outcomes.map(([id, label]) => <label key={id} className="check"><input type="radio" name="outcome" value={id} checked={review.outcome === id} onChange={() => setReview({ ...review, outcome: id })} required/><span>{label}</span></label>)}</fieldset>
        {plan.evidence.group.compared > 0 && <p className="muted">From the marks: {plan.evidence.group.improved} of {plan.evidence.group.compared} up 5 or more points, {plan.evidence.group.dropped} down 5 or more.</p>}
        <label>Note<textarea rows={2} value={review.note} onChange={e => setReview({ ...review, note: e.target.value })} required minLength={3} maxLength={500} placeholder="What you saw, and what happens next"/></label>
        <fieldset className="choice-row"><legend>Next</legend>
          <label className="check"><input type="radio" name="decision" checked={review.decision === 'continue'} onChange={() => setReview({ ...review, decision: 'continue' })}/><span>Continue and review again</span></label>
          <label className="check"><input type="radio" name="decision" checked={review.decision === 'close'} onChange={() => setReview({ ...review, decision: 'close' })}/><span>Close the plan</span></label></fieldset>
        {review.decision === 'continue' && <label>Next review<input type="date" value={review.nextReviewDate} min={addDays(today, 1)} onChange={e => setReview({ ...review, nextReviewDate: e.target.value })} required/></label>}
        <button disabled={busy || !review.outcome}>Save review</button>
      </form>}
    </>}
  </Dialog>;
}

export function SupportList({ plans, today, showClass, onOpen }: { plans: Plan[]; today: string; showClass: boolean; onOpen: (id: string) => void }) {
  if (!plans.length) return <Empty title="No support plans here" hint="Start one from Needs attention on Trends, or from a weak indicator on Gaps."/>;
  return <div className="table-wrap"><table><thead><tr><th>Learners</th><th>Focus</th><th>Action</th><th>Responsible</th><th>Review</th><th className="num">Change</th></tr></thead><tbody>
    {plans.map(p => <tr key={p.id}><td><button type="button" className="link-button" onClick={() => onOpen(p.id)}>{p.learners.length > 2 ? `${p.learners.slice(0, 2).map(l => l.full_name).join(', ')} +${p.learners.length - 2}` : p.learners.map(l => l.full_name).join(', ')}</button>{showClass && <span className="sub">{p.class_name}</span>}</td>
      <td>{p.subject_name}{(p.indicator_code || p.indicator_description) && <span className="sub">{p.indicator_code ?? p.indicator_description}</span>}</td><td>{p.action}</td><td>{p.owner_name}</td><td>{reviewPill(p, today)}</td>
      <td className={`num tone-${changeTone(p.evidence.change)}`}>{signed(p.evidence.change)}<span className="sub">{p.evidence.before ?? '–'} → {p.evidence.since ?? '–'}</span></td></tr>)}</tbody></table></div>;
}

// Today page: the support reviews this person is due to do, linking to the Support tab. Nothing shows when none are due.
export function SupportDue({ schoolId }: { schoolId: string }) {
  const [plans, setPlans] = useState<{ today: string; items: Plan[] } | null>(null);
  useEffect(() => { request<{ today: string; items: Plan[] }>(`/schools/${schoolId}/support-plans?status=open`).then(setPlans).catch(() => setPlans(null)); }, [schoolId]);
  const due = plans?.items.filter(p => p.due) ?? [];
  if (!plans || !due.length) return null;
  return <section aria-label="Support reviews due" className="page"><div className="banner"><span className="icon" aria-hidden="true">event_upcoming</span>
    <span><strong>{due.length} support review{due.length === 1 ? ' is' : 's are'} due:</strong> {due.map(p => `${p.class_name} ${p.subject_name} (${p.learners.length === 1 ? p.learners[0]!.full_name : `${p.learners.length} learners`})`).join(', ')}.</span>
    <a className="button secondary" href="#/progress/support">Review now</a></div></section>;
}
