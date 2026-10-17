# Domain rules and acceptance cases

Status: proposed. Read only the section relevant to the task. All sections inherit the tenant/access rules in [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Learners, guardians and early years

Admissions: enquiry/application → review → offered/waitlisted/declined → accepted → enrolled. An authorized admission creates the learner and dated enrolment atomically; it does not silently create a login or invoice. Check duplicates, school-unique admission numbers and capacity; an override needs a reason. Missing optional documents stay missing rather than being invented.

Keep multiple guardian links with verified academic/billing/pickup/contact rights. Do not require national identity documents or sensitive demographic fields without a documented purpose. Archive/transfer/withdraw learners through effective-dated records. Promotion previews next-year enrolments and preserves previous classes/reports; never increment a class number in place.

Student details (nationality, home address, previous school, emergency contact, blood group, health notes, religion) are optional and only the headteacher records them, saved whole with a version check. Religion, blood group and health notes are sensitive: never required, recorded only if the family agrees, and never sent to AI. Religion, nationality and address are headteacher-only; a teacher sees previous school, blood group, health notes and emergency contact for students in a class they teach today. The audit event names the fields that changed, never their values, and the printed student record leaves out religion and health.

Nursery/KG observations capture date, educator, reviewed indicator/rubric and evidence. Report narrative progress, not a universal exam rank. Nursery care/development expectations require specialist review. Authorized collection records the verified collector, time and releasing staff; unexpected pickup goes to designated staff. Payment authority is not collection authority.

**Acceptance:** duplicate import/promotion replay creates no duplicate enrolment; a mid-term transfer preserves history; revoked/restricted guardians lose access; unauthorized pickup is blocked; a teacher never receives religion or home address and cannot edit details, and a stale save is refused; a KG report has appropriate observations without inherited A1–F9 bands.

## 2. Attendance and follow-up

Roster derives from eligible enrolments and school-open dates. Register lifecycle: open/draft → submitted → locked. Marks: unmarked, present, late, absent, excused. Unmarked is never automatically absent. School policy defines late/excused treatment and denominator; exclude closures and dates outside enrolment.

Save with expected version and retry-safe operation ID. Submitted corrections need a reason; locked-period changes need a reviewer. Only confirmed submitted absence can start an absence notice. Staff review circumstances and contact authority; an explainable repeated-absence rule creates a follow-up task, not a permanent risk label.

Support loop: evidence → assigned action/owner → due date → reassessment → resolved/continuing/dismissed with reason. Do not claim a child's future outcome from attendance data.

**Acceptance:** save/reload agrees; concurrent edits conflict visibly; retries do not duplicate events; late admissions and closures produce correct denominators; corrected absence cancels/reviews a queued notice.

## 3. Curriculum, assessment and reports

Version curriculum by issuer/source, effective dates, level, learning area, strand/sub-strand and indicator. Preserve official codes where verified and distinguish local additions. Nursery, KG, Primary, JHS and future SHS require appropriate policies. A school-approved configuration is not automatically a national requirement.

Each assessment policy specifies components, maximum scores, weights, rubrics/bands, rounding, missing/exempt/retake rules, approvers and report template. Numeric contribution = earned/maximum × weight; weights sum to 100. An illustrative 40/60 split is not a Ghana-wide default. Use exact decimals and explicit boundary/tie rules. Missing, absent and exempt are distinct from zero; reweighting requires an explicit policy.

Keep internal reports, mock exams and official BECE/WASSCE results separate. Do not predict official grades with fixed percentage thresholds. Rankings are optional, off for early years by default, and require comparable cohorts/assessments. Averages use valid denominators rather than treating missing subjects as zero.

Workflow: draft → submitted → returned/approved → published → corrected version. Approval binds exact inputs; later edits invalidate it. Publication freezes identity/class, policy, scores/evidence, attendance and approvers. Corrections create a superseding snapshot. Guardians see only published records; teacher/AI comments need human review.

SHS seam: separate levels, curricula, calendars and subject offerings now; add pathways, individual subject enrolment, combinations and transcripts when commissioned. Revalidate current policy and exam formats. Adding three classes does not make the product SHS-ready.

**Acceptance:** policy changes leave old reports unchanged; missing marks remain explicit; out-of-scope teachers cannot edit; stale approvals cannot publish; reports preserve historical classes; AI remarks cite evidence and do not invent traits/diagnoses.

## 4. Fees, payments and reconciliation

Build an immutable operational fees subledger. It is not a full general ledger or payroll product. Label collections, outstanding fees, refunds, charges, settlements and cash/expense summaries accurately; do not present cash surplus as audited profit.

Version fee schedules, concessions and due installments. Preview billing scope/totals before posting. Draft invoices can be cancelled; posted amounts change through referenced credit/debit adjustments. Due installments partition the charge, not multiply it. Age only unpaid amounts already due, using a documented allocation order.

Use integer pesewas and server-issued unique receipt numbers. At a cutoff:

- Invoice due = posted charges + debit adjustments − credit adjustments − active allocations.
- Unallocated payment = accepted/verified amount − active allocations − completed refunds from unallocated funds.

Refunding allocated money requires releasing the allocation first; reserve pending refunds to prevent double use. Lock affected balances and enforce same-school references. Overpayment becomes unapplied credit; never silently allocate to a sibling. Reversals/refunds preserve history and need authorized reasons. Approval separation is school-configured, with explicit one-person exceptions where accepted. Closed-period records cannot be silently edited.

Cash requires named collector/receipt and cash reconciliation. Manual bank/MoMo evidence remains pending until authorized verification. Integrated payments require verified server-side provider facts matching merchant, reference, amount and currency. Browser success cannot mark fees paid. Store no card secrets or MoMo PINs.

Provider path: stable intent/reference → initiate outside DB transaction → verify signed webhook → durably deduplicate → map trusted merchant/reference to school → post once → reconcile settlement. Handle late success, missing/out-of-order callbacks, wrong amounts, refunds and uncertain states. Provider success and bank settlement are separate; reconcile gross receipts, provider charges and net settlement. Unknown events enter an exception queue.

Example: GHS 1,000 billed and GHS 600 allocated leaves GHS 400 due. Duplicate callback changes nothing. Refund GHS 100 without reducing the original charge: reverse that allocation and refund it; GHS 500 is now due. A reduced charge requires its own credit note.

School money settles through the school's approved merchant arrangement. SaaS subscriptions are separate. Select a regulated provider and validate commercial/settlement terms; no provider is selected yet.

**Acceptance:** exact statement reconciliation; no double posting after retries/crashes; concurrent allocations/refunds cannot overspend; fake callback/wrong merchant cannot change balances; imports reconcile opening totals; corrections preserve original entries.

## 5. Communication, staff and scheduling

Messages: draft → approved → queued → processing → delivered/failed/unknown/cancelled. Track recipient/channel attempts separately. Before approval show exact content, audience/exclusions, timing and cost. Changes invalidate approval. Recheck contact rights, permissions and underlying facts before dispatch; paid fees should not trigger stale debt reminders.

Provider-accepted is not delivered; delivered is not read. Use approved templates, quiet hours, contact preferences and applicable opt-outs. Automation requires explicit bounded configuration; AI cannot enable sending. Do not assume WhatsApp access or current provider rules. Direct government/WAEC integrations require authorized specifications; start with reviewed exports only when formats are confirmed.

Staff employment records are separate from login roles. Optional staff details (job title, staff number, qualification, teaching licence, date joined, employment type, subjects, address, emergency contact) are recorded by the headteacher only; a staff number is unique within a school. Teaching assignments are effective-dated. Timetable draft → conflict validation → published version; reject overlapping teacher/class/room bookings. Start with manual scheduling, not the demo's solver.

**Acceptance:** recipient rights revoked while queued prevent delivery; stale notices are reviewed/cancelled; retries do not blindly resend uncertain operations; teacher/class/room conflicts are visible; no unauthorized staff detail leaks through search or exports.

## 6. Definition of done for a feature

Record scope, invariants and acceptance cases before coding. Include success, denied access, invalid input, stale/concurrent write and retry behavior. Verify the actual runtime DB role and at least two schools for data changes; UI-only guards are insufficient. Verify a real click and persisted visible result for interactions, including mobile/keyboard where applicable.

Handoff: exact changed files, checks/results, mocked or unverified dependencies and next action. A first live pilot additionally needs academic/finance sign-off, provider acceptance, current privacy/legal arrangements, restore evidence and school-user acceptance. No unresolved critical isolation, financial-integrity or unapproved-AI-action failures may pass that gate.
