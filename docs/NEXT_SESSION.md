# Next session: headteacher features

Start here. Read `MEMORY.md`, `AGENT.md` and `STATUS.md` first (see `AGENTS.md`), then only the sections a task needs.

## Where things stand (2026-10-12)

- A trial school, **Nkabom Basic School (Trial)**, runs on Supabase: KG 1–JHS 3, 249 learners, Term 3 of 2025/26 complete, Term 1 of 2026/27 up to 12 Oct.
  - Logins and state: `.local/term-trial/state.json` (ignored by Git).
  - Driver: `backend/scripts/term-trial.ts` (phases `setup|enrol|guardians|term|exams|close|current|status`).
- Hosted migrations go up to **032**. Any new migration needs Evans's explicit approval before the hosted apply (preview, then `--apply`).
- Tests: 176 backend and 17 browser tests.
  - Run them in an isolated copy (`.local/t`), because `npm test` rebuilds `backend/dist` and restarts a running cloud API.
  - The browser tests reuse ports 3018/5178, so never run them while `dev:cloud` is up.
- Evans's uncommitted work (`Teaching.tsx`, roster CSS, `README.md`, `demo-seed.ts`, `EarlyYears.tsx`) must stay out of commits. Stage `style.css` changes selectively.
  - The teacher-grant browser test fails with that work in place (phone-width overflow).
- Push tested features to `main` (see `AGENTS.md`).

## Working rules for each item

One bounded slice at a time:

1. Backend with tests.
2. UI.
3. Browser test where there is UI.
4. Exercise it on the trial school.
5. Update STATUS.md.
6. Push.

Keep school isolation (RLS), append-only history and human approval. The platform never deletes or silently changes records.

---

## Checklist

### 1. Headteacher's morning view (no migration expected)

- [ ] One Home section answers:
  - [ ] Registers not taken today.
  - [ ] Learners absent 3+ days this week, and whether a guardian was contacted.
  - [ ] Fees collected this week compared with the same week last term.
  - [ ] Classes or subjects with missing scores as the term end approaches.
- [ ] Every item links to the page where it is fixed.
- [ ] Opens in under 2 s on the trial school, measured against the API.

### 2. Bulk work

- [ ] Update existing learners from a CSV (sex, date of birth, name corrections): staged, previewed and approved like imports, with history kept.
- [ ] Apply one discount or charge to many bills at once (e.g. all staff wards), with one reason, recorded per bill.
- [ ] Print report cards for the whole school or a level, one card per page.

### 3. Fees as parents actually pay

- [ ] One payment split across several children or terms (oldest balance first, editable before saving). Each receipt shows the split.
- [ ] Payment plans: agreed instalments per family, with "behind on plan" on the morning view.
- [ ] Refunds paid out against a credit, reasoned and receipted.
- [ ] Daily feeding or canteen fees collected at the gate, with a daily cash-up per collector.
- [ ] Expenses and a simple cash book (money in and out by category, by term), with a printable summary.
- [ ] Mobile Money reference reconciliation (manual matching first; gateway later, per MEMORY).

### 4. Reaching parents without the app

- [ ] Same-morning absence SMS when a register is submitted (opt-in per school, at-most-once, uses the existing SMS sender). Requires an SMS provider sandbox: **ask Evans before any real send.**
- [ ] "Report cards are ready" and reopening-date notices sent automatically on publication and vacation, after head approval.
- [ ] A guardian contact record for families who will never sign in (name + phone, verified like a link), so they receive SMS and appear on pickup lists.

### 5. Staff

- [ ] Subject-level teaching assignments for JHS, so a subject teacher enters only their subjects.
- [ ] Staff attendance and lateness (sign-in at the gate or by the head).
- [ ] Weekly lesson-note submission and head vetting (submitted / vetted / returned with a comment), with a missing-notes list.
- [ ] Score-entry deadline per term, and a list of late teachers.

### 6. GES and district paperwork

- [ ] Annual school census: enrolment by class, sex and age, printable. Start from `GET /learners/census`.
- [ ] BECE registration list for JHS 3 (name, sex, date of birth, index number field).
- [ ] Transfer letters and leaving certificates generated from the learner record on withdrawal.
- [ ] Termly attendance summary per class.

### 7. Performance over time (data already exists)

Every published terminal report is an immutable snapshot per learner per term, and every score entry is kept.

- [ ] **Learner trend:** a per-subject total and average across terms, with position history. Visible to the head and to the class teacher of the learner's current class. Guardians see their own child's trend only after the head turns it on.
- [ ] **Class and subject trend:** average, spread and pass rate per subject per term; this term compared with last term and with the same term last year.
- [ ] **Teacher view:** the subjects they taught and how each class moved (a coaching aid, not a ranking of teachers).
- [ ] **Early warning list:** learners whose average fell by more than a set number of points, or who dropped a grade band in core subjects, combined with attendance below a threshold. The head sets the thresholds. The list says "review", never "failing".
- [ ] All figures computed in SQL from snapshots and scores (deterministic, like terminal results); no AI needed.

### 8. BECE outlook (do last, with care)

What is possible and honest:

- [ ] Record **mock examination** results as their own assessment type (JHS 2 end-of-year, JHS 3 mocks), on the BECE grade scale 1–9.
- [ ] Record **actual BECE results** when WAEC releases them, so the school builds its own history.
- [ ] **Readiness view:** for each JHS 3 learner, current mock grades per subject, recent trend and attendance, plus a plain flag such as "needs support in Mathematics", using rules the head sets.
- [ ] Only after the school has at least 2–3 years of mock-to-BECE pairs: a calibrated estimate of each subject's grade **range**, shown with how often past estimates were right. Never show a single predicted grade.

Guardrails:
- Human review always.
- Shown to the head and teachers. Shared with families only by a head decision, and framed as support.
- Never used for admission or exclusion decisions.
- No AI-generated predictions about individual children until a written evaluation exists (see `docs/AI_DESIGN.md`: AI drafts only, no ranking or diagnosis language).
- One-school data is small: say so on screen.

### 9. Speed and resilience

- [ ] Measure register save/load time on the real host (Render + Supabase, same region). Target under 1 s.
- [ ] Profile a register save: round trips per request. Batch queries if needed.
- [ ] Offline-tolerant register: save marks on the phone and submit when the connection returns, keeping the existing version checks.
- [ ] A friendly message instead of a 500 when the database is briefly unavailable. A Supabase blip returned 500s during the trial.

### 10. Housekeeping found during the trial

- [ ] Accounts endpoints accept an `operationId`, so a retried "create account" cannot make two accounts.
- [ ] The Assessment grid has the same stale-response risk the remarks table had: apply the same guard.
- [ ] Academic year and term dates cannot be corrected after creation. Add a reasoned correction that is refused if it would orphan registers, scores or bills.
- [ ] Decide with Evans whether to keep or remove the trial school data on Supabase.
