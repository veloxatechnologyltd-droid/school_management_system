# Home Learning Pass: production build checklist

Status: proposal for review, 2026-10-15. A sellable, parent-paid product built on the school system. Nothing here is built unless marked **(exists)**. Prices, uptake, revenue shares and content volumes are working figures to validate.

## 0. The product

Parents pay **GH₵50 per child per term** (launch price) for learning their child does at home, on the parent's phone or on paper. Build the value to justify up to GH₵100; raise the price only once uptake and renewal give evidence.

| Stage | Promise to parents | Core of the paid product |
| --- | --- | --- |
| Lower Primary (B1–B3) | "Help your child read and count with confidence, in 10 minutes a day." | Picture and sound games for reading and numbers |
| Upper Primary (B4–B6) | "Weekly practice on the exact topics your child finds hard, and ready for end-of-term exams." | Topic mastery with hints, comprehension, exam papers |
| JHS (1–3) | "BECE practice with mock scores, so you know where your child stands." | BECE-style drills, timed mocks, targets |
| Nursery/KG | Free activities and notes for parents | No paid pass at launch |

**Free for every family, always:** reports, fees, notices, the progress view, and basic home practice **(exists)**. Paying never changes what the school records or reports about a child.

**Paid pass:** enough daily practice for the whole term, the stage products above, parent guides with audio, the daily plan, the end-of-term parent report and the printable weekly pack.

### Parent test (every stage must pass before it is sold)
- [ ] **Enough:** something useful every school day of the term; the child never runs out.
- [ ] **Right level:** practice targets this child's weak topics.
- [ ] **Parent can help:** a parent who doesn't know the topic can still guide the child.
- [ ] **Visible results:** at term end the parent sees what changed, in numbers and plain words.
- [ ] **Worth more than the alternative:** parents rate it above what they already pay for (extra classes, lesson teachers, past-question books). Check local prices; don't assume them.

### Where we stand against the parent test (2026-10-15, honest status)

Parents pay, so none of the infrastructure counts until a parent would pay for what a child gets. Built so far: home practice (free tier), Claude drafts for teachers from a one-line indicator, and a central content library that is now parked (see phase 2). **No stage passes the test today.**

| Criterion | Today | What closes it |
| --- | --- | --- |
| Enough | **Not met.** A child gets at most three weak topics, 2 sessions a topic a day, from one school-approved set of 5–8 questions per level, so a topic runs dry in days. | Questions drafted from the school's own term material on demand for each weak topic, enough per level that a child does not run out (phase 2), then the daily plan and no-repeat window (phase 4). |
| Right level | **Partly.** Weak topics come from the school's tagged class work, with three levels and simple up/down rules. | Mastery per indicator and spaced review (phase 4). |
| Parent can help | **Not met.** No parent guide exists for a parent to read. | Guides drafted from the school's material, approved by the teacher and shown in the portal (phase 6), with audio. |
| Visible results | **Not met.** Parents see topic, level and sessions only; no report. Whether parents may see numbers is an open decision for Evans. | End-of-term report (phase 6), after that decision. |
| Worth more than the alternative | **Not tested.** No local prices checked, no parent asked. | Price research and the internal pilot (phases 1 and 13). |

**Teacher time is the constraint now (working figures, to validate).** With school-grounded drafting the review work sits with the school's own teachers, one weak topic at a time, instead of a central team reviewing a whole stage. Claude drafts only from the material the school added, so a school that adds none gets nothing. In the pilot, measure how long a teacher takes to read and approve a 20-question draft, how often questions are edited or rejected, and how often the material did not cover the topic, before promising more.

**Agreed direction (Evans, 2026-10-15):** what a child learns comes from the school's own term material; no central catalogue and no central review team are needed (MEMORY.md).

**Still proposed, not decided:** make one stage good before breadth: **Upper Primary (Basic 4–6) Maths and English first**, because it builds on what exists (weak topics from class marks; multiple-choice and number questions need no pictures or audio). Then pull forward what a parent sees: term material with grounded drafting and one-click Plan learning (phase 2), the daily plan, guides in the portal and the end-of-term report. Run it free with staff families at one school (phase 13, step 1) and ask parents the five questions above before any payment work (phases 7–9). Lower Primary needs audio, pictures and a player and JHS needs timed papers and passages, so both come after.

---

## Phase 1. Decisions and legal (blocks launch, not building)

- [ ] Merchant of record: the platform collects and pays schools their share (recommended), or the school collects and is invoiced.
- [ ] Payment provider chosen (Paystack, Hubtel or another Bank of Ghana–approved provider); fees, settlement times and payout method confirmed in writing.
- [ ] Company registration, tax treatment of pass income and of school payouts confirmed with an accountant.
- [ ] Registration and duties under Ghana's Data Protection Act confirmed (current requirements, not assumed), including processing children's data with guardian consent.
- [ ] Parent terms of service: what the pass includes, term dates, refund rules, what happens if the child changes school.
- [ ] Privacy notice for parents in plain English: what is collected, why, who sees it, how long it is kept, no adverts, no data sales.
- [ ] School agreement: revenue share, cost-recovery threshold, payouts, no-pressure rule, school's duties (teacher sign-off where needed), ending the agreement.
- [ ] Content rights policy: Claude drafts original questions from the school's own material; the platform adds no WAEC papers or publisher material; the school is responsible for having the right to use what it adds; ownership of commissioned pictures and audio.
- [ ] School material terms: material a school adds is private to that school, never shown to another school and never used to train models; Anthropic's API terms (no training on inputs, retention) confirmed in writing before real school material is sent.
- [ ] Price, sibling discount, mid-term purchase rule (full price or pro-rata) and refund window agreed.
- [ ] Support ownership: who answers parents, by which channel, in which hours.

**Done when:** each item has a written decision in MEMORY.md and signed documents where needed.

---

## Phase 2. School-grounded content (the product's foundation)

**Direction (Evans, 2026-10-15): what a child learns comes from what their own school teaches this term.** The teacher puts in the term's material; Claude drafts teaching notes, questions and plans from that material, never from its general knowledge of a topic; the school's teacher reads and approves before any child sees it. There is no central catalogue and no central review team. A central library was built first (slices 2a and 2b, below); it is parked and not on this path.

Why: a child taught something the school has not covered gains nothing in the end-of-term exam, parents stop paying, and a central list cannot know each school's pacing, books or scheme of work. Schools already enter their own indicators and tag class tests to them **(exists)**.

### Term material
- [ ] A teacher (or the headteacher) adds the term's material per class and subject: the syllabus or scheme of work, lesson notes, textbook extracts. Pasted text first; file upload and photos of pages later. A source note is required, as for indicators **(pattern exists)**.
- [ ] Private to the school: never shown to another school, never used to train models; a school-scoped table with row-level security **(pattern exists)**. The school confirms it may use what it adds.
- [ ] Append-only versions with who added it and when; a newer version replaces the older one without deleting it.
- [ ] Material can be linked to the school's indicators (optional) so a topic's drafts use the right passages.
- [ ] Size limits, and a clear message when material is too long for one drafting call (split by section; no silent cutting).

### Grounded drafting
- [ ] Claude drafts worksheets, practice questions, parent guides and learning plans from the school's material only, through the existing AI layer **(exists: kill switch, school switch, monthly cap, run log without text)**. Each draft cites the passages it used and the teacher sees them at approval.
- [ ] If the material does not cover a topic, the draft says so and nothing is invented; the teacher adds material or writes the questions.
- [ ] No learner data goes to the model, only the material and the indicator **(rule exists)**.
- [ ] Automatic checks before the teacher sees a question: number answers worked out by the computer, no repeats, labelling words, reading level for the stage, exactly one right answer **(the checks module exists, built for the central library; reuse it)**.
- [ ] The teacher reads, edits and approves; nothing reaches a child until then **(exists for question sets)**; the same for worksheets and guides.
- [ ] Enough questions per indicator and level that a child does not run out (working figure: 20 per level, about two weeks without repeats), drafted on demand when a teacher plans learning for a weak topic, not for the whole syllabus in advance.
- [ ] A teacher can flag any question "not what we taught" or "the answer looks wrong": it stops being served at once and goes back to the teacher to fix as a new version.

### Media
- [ ] Pictures and audio arrive with the question types in phase 3 and need object storage (none exists today). Not needed for Upper Primary.

**Done when:** a teacher adds a term's material for one class, clicks Plan on a weak topic, and gets a plan plus questions that cite that material; approves them; and the child's home practice uses them. A topic the material does not cover is refused, not invented.

### Built before this direction, now parked (not on the path)
Slices 2a and 2b built a platform-owned library: content roles (author, reviewer, lead), a central curriculum catalogue, versioned platform questions and parent guides, a central review queue, and Claude batch drafting with a platform run log and token budget (migrations 046–048, on hosted, idle: the drafting budget is 0). Nothing from it reaches a school or a child. It stays in place for now; removing it needs Evans's go-ahead. Worth reusing: the automatic checks, the answer-and-options validator, the three-phase drafting pattern with its prompt-injection and unstorable-character fixes, and the budget idea (a platform-wide spend cap).
- [x] Platform curriculum catalogue, content roles, versioned platform questions and guides, review screen, automatic checks. **Built (slice 2a), parked.**
- [x] Claude batch drafting into the central library with a platform run log and budget. **Built (slice 2b), parked.**
- [ ] ~~Matching school indicators to catalogue entries; schools hiding platform items; central error reports; 5% central sampling QA; central coverage targets.~~ **Dropped: no central catalogue.**

---

## Phase 3. Question types and the player

Exists: multiple choice and number answers, 5-question sessions, levels 1–3 **(`backend/src/modules/practice`)**.

### New question types (each with a validator extending `checkQuestions`, a player component and tests)
- [ ] Tap the picture (2–4 pictures, audio prompt).
- [ ] Count and choose (1–20 objects, then to 100 with tens).
- [ ] Listen and choose (audio word, sound or number).
- [ ] Match pairs (picture–word, number–quantity, capital–small letter).
- [ ] Drag to sort into two or three groups.
- [ ] Make the amount with cedi coins and notes.
- [ ] Missing letter or number in a pattern.
- [ ] Read aloud: the child reads a sentence, the parent taps "read well / needed help" (no voice recording stored).
- [ ] Reading passage with questions.
- [ ] Worked problem with up to 3 hints, shown one at a time after a wrong answer, then the worked solution.
- [ ] Short written answer for JHS composition practice with a parent marking guide (AI feedback only after a separate quality review).

### Player requirements
- [ ] Audio plays for every instruction in Lower Primary; replay button; works with the phone on silent warning.
- [ ] Touch targets at least 48 px; works one-handed on a 360 px wide screen.
- [ ] Session content downloaded at start; answers queued and sent when the connection returns; a dropped connection never loses an answer or double-counts one (answers are recorded once **(exists)**).
- [ ] Runs on a cheap Android phone (2 GB RAM, Chrome) on 3G; tested on a real device.
- [ ] Stars, sticker collection and a voice "well done"; no leaderboards, no comparison between children.
- [ ] Shuffles options; never shows the answer before the child answers.
- [ ] Accessible: readable fonts, colour not the only signal, screen-reader labels.

**Done when:** every type plays on a real low-end phone over throttled 3G, and the demo parent's children complete sessions of each type.

---

## Phase 4. Learning engine

- [ ] Mastery per child per indicator, from practice and the school's class marks **(class marks exist)**.
- [ ] Levels per indicator (keep 3 **(exists)** or extend per stage; decide).
- [ ] No-repeat window: a child doesn't see the same question for 14 days while others are available.
- [ ] Spaced review: passed indicators come back briefly after 1, 3 and 6 weeks.
- [ ] Daily plan: "Today: 2 sessions, about 10 minutes", from weakest indicators plus due reviews; adjustable by the parent (lighter or heavier).
- [ ] Limits: sessions per topic per day **(exists: 2)** and a daily total, so screen time stays short.
- [ ] The plan follows the school's term: indicators taught recently come first.
- [ ] Teacher-set focus: a support plan's topic **(support plans exist)** goes to the top of that child's plan.
- [ ] Streaks forgive one missed day; no punishment for missed days.
- [ ] All rules in one module with unit tests, like `practice/rules.ts` **(exists)**.

**Done when:** a simulated term for 50 demo children shows sensible plans, no repeats inside the window, and review sessions on time.

---

## Phase 5. Stage products

### Lower Primary (B1–B3)
- [ ] Reading track: letter sounds → blending → sight words → short sentences → short stories.
- [ ] Number track: counting → place value → adding and subtracting → early times tables → money, shapes, time.
- [ ] Level shown simply to parents: "reads 3-letter words", "adds to 20".
- [ ] Weekly bedtime reading card (printable short story with three questions).

### Upper Primary (B4–B6)
- [ ] Topic mastery with hints and worked solutions in Maths, English, Science.
- [ ] Reading comprehension at the child's level, with vocabulary.
- [ ] Times-table and mental-maths speed drills.
- [ ] End-of-term exam practice: a timed mixed paper per subject in the last 3 weeks of term.
- [ ] B6 "Ready for JHS" check in Maths and English, with a summer plan.

### JHS (1–3)
- [ ] BECE-style topic drills with worked solutions (original questions).
- [ ] Timed mock papers per subject: timer, pause rules, submit, score, time per section.
- [ ] Mock history and trend per subject; mock results kept apart from the school's official mock records **(school mocks exist)** unless the school chooses to see them.
- [ ] Target per subject, set by the parent (teacher can suggest); progress toward it.
- [ ] After each mock, a two-week weak-topic plan feeds the daily plan.
- [ ] JHS 3: countdown to the BECE and a week-by-week revision plan.

**Done when:** each stage passes the parent test with at least 10 real parents per stage at the pilot school.

---

## Phase 6. Parent experience

- [ ] Onboarding: first visit explains free vs paid in one screen, with a sample session the child can try free.
- [ ] Child picker for families with several children **(exists in the portal)**; each child shows pass status.
- [ ] Today screen per child: today's plan, streak, last result, one line from the teacher if any.
- [ ] "How to help at home" guide per topic: what the child is learning, one worked example, common mistakes, a 5-minute activity with things in the house; audio version.
- [ ] Weekly message (portal and SMS **(SMS sending exists)**): what the child practised, what's next. Parent can switch SMS off.
- [ ] Mid-term check-in: on track or needs more practice.
- [ ] End-of-term parent report, printable PDF: sessions done, topics and levels gained, class marks before and after on practised topics, attendance, teacher's note. Wording never claims the app caused the change.
- [ ] Printable weekly pack PDF: one A4 page per child per week from their weak topics, plus an answer page; prints well in black and white.
- [ ] School printing option for families without smartphones (decide whether the school charges or it's included).
- [ ] English first; other languages only with human translation review.
- [ ] Help screen and a "contact support" route that reaches a person.

**Done when:** a phone-only demo parent can buy (simulated), use for a week and read the report without help.

---

## Phase 7. Pass and access

- [ ] Price table per school and term (platform-set; launch GH₵50; sibling discount).
- [ ] Term pass per child per term: pending → active → expired, or refunded; append-only history of every change with who and why.
- [ ] Every paid feature checked on the server; screens hide paid features without a pass, but the server is the guard.
- [ ] Pass ends with the term; a short grace period into the holidays (decide length) so revision can continue.
- [ ] Child changes school mid-term: pass moves if the new school offers it, otherwise pro-rata refund.
- [ ] Child leaves (BECE done, withdrawn): pass ends at term end; no renewal offer.
- [ ] Headteacher switch decides whether the school offers the pass (home practice switch **exists**; pass gets its own).
- [ ] Platform admin can grant passes by hand (pilots, hardship, support fixes), with a reason recorded.
- [ ] Hardship or scholarship passes the school can fund (decide).

**Done when:** tests show no paid content reachable without a pass, and free features unchanged when a pass expires.

---

## Phase 8. Payments

- [ ] Checkout: parent picks children and term, sees the total, pays by mobile money (MTN, Telecel, AirtelTigo); card optional.
- [ ] Payment confirmed only by the provider's signed webhook plus a server-side verification call; never by the browser.
- [ ] Idempotency: a double tap, retry or repeated webhook never charges twice or grants twice.
- [ ] Payment records append-only, amounts in integer pesewas (as finance does **(exists)**); sequential receipt numbers.
- [ ] Receipt by SMS and in the portal.
- [ ] Failed and abandoned payments: clear message, retry, no pass granted.
- [ ] Refunds: within the agreed window or by support decision, with reason; pass ends; revenue-share ledger adjusted.
- [ ] Daily reconciliation job against the provider's settlement report; mismatches flagged to platform finance.
- [ ] Renewal reminders before each term (SMS and portal); no automatic debit without explicit consent.
- [ ] Pass fees kept completely separate from the school's own fee invoices and receipts.
- [ ] Sandbox tests for every webhook event; a live test with small real amounts before launch.

**Done when:** a full term of simulated purchases, failures, retries and refunds reconciles to the cedi.

---

## Phase 9. School revenue share

- [ ] Ledger per school per term: gross pass revenue, payment fees, refunds, net, cost-recovery threshold, 50/50 split above it.
- [ ] Threshold set per school from its cost to serve (hosting, support, SMS, AI); recorded with the agreement version.
- [ ] Term statement to the headteacher: counts and amounts only, never which parents paid or didn't.
- [ ] Payouts by mobile money or bank after the term's refund window closes; each payout recorded and receipted.
- [ ] Headteacher dashboard: uptake by stage and class (counts), usage (sessions per child), parent ratings.
- [ ] Platform finance dashboard: revenue, refunds, payouts due, cost per school, margin per school.

**Done when:** two schools' simulated terms produce correct statements and payouts by hand calculation.

---

## Phase 10. Teacher and school side

- [ ] Teachers see paid and free practice the same way on the learner page and class view **(exist)**, without seeing who paid.
- [ ] Teacher can set a child's focus topic from a support plan.
- [ ] Teacher can flag any question "not what we taught" or wrong; it stops being served at once.
- [ ] Questions, worksheets and guides drafted from the school's material use the approval flow **(exists for question sets)**.
- [ ] Headteacher settings: offer the pass, school printing option, who may add term material.

---

## Phase 11. Platform operations

- [ ] Monitoring and alerts: API errors, webhook failures, payment mismatches, worker jobs, storage and CDN errors.
- [ ] Production hosting on paid plans: API not sleeping, worker running (Render free plan and disabled worker noted in STATUS.md must change).
- [ ] Backups with a tested restore; payment and pass records included.
- [ ] Product analytics with no personal data: sessions started and finished, plans followed, drop-off points, renewal.
- [ ] Cost tracking per school per term: hosting, storage, SMS, AI, payment fees.
- [ ] AI spend caps per school **(exists)** and platform-wide; drafting from a school's material counts against that school's cap. *(The central drafting budget built in slice 2b is parked with the central library.)*
- [ ] Support inbox: parent questions, refund requests, wrong-answer reports; response targets.
- [ ] Incident runbook: payments down, content error published, data exposure.
- [ ] Security review before launch *(slice 2a: an independent read-only review of the content tables, roles and checks is done and its six findings are fixed in migration 047; the full launch review is still open)*: payment routes, webhooks, pass checks, school isolation of all new tables (RLS on every school table **(pattern exists)**), platform tables read-only to schools.

---

## Phase 12. Testing and acceptance

- [ ] Unit tests: every validator, learning-engine rule, price and revenue-share calculation. *(Slice 2a: content body validators and the automatic checks are covered; learning-engine, price and revenue-share rules do not exist yet.)*
- [ ] API tests: pass checks, payment webhooks (valid, forged, repeated, out of order), refunds, school isolation, guardian rights.
- [ ] Browser tests per stage: buy (simulated), play each question type, daily plan, guides, report, printable pack; at 390 px and 1440 px.
- [ ] Real-device test on a low-end Android phone over 3G.
- [ ] Load test: 2,000 children practising in the same evening hour across schools.
- [ ] Pilot measures on drafted questions (teacher approval rate, edit and reject rate, questions flagged "not what we taught") and a sign-off per stage on the parent test.
- [ ] Sunrise demo school loaded with every feature and walked through as parent, teacher, headteacher and platform admin before each push. *(Repeats every slice. Slice 2a: demo content library loaded locally with `npm run demo:content` and walked through as lead, author, reviewer and platform admin; not run on hosted. No parent, teacher or headteacher screen exists for it yet. Slice 2b repeats it: the demo loader adds a drafting budget and one Claude batch, and the Drafting tab, draft dialog, review queue and platform budget were walked through as author, reviewer, lead and platform administrator at 1440 and 390 px against a local stand-in for Claude.)*
- [ ] Local tests, demo, hosted deployment and school acceptance are reported separately; none stands for another. *(Repeats every slice. Slice 2a: local tests and local demo, then hosted migrations 046 and 047 applied and the slice pushed on 2026-10-15 at Evans's request; the live `/readyz` check after Render's deploy, the demo content on hosted, and school acceptance are not done. Slice 2b: local tests and local demo, then hosted migration 048 applied to Supabase on 2026-10-15 at Evans's request (previewed first: exactly 048 pending; applied; second preview all applied; `school_app` connects with TLS) and the slice pushed; the live `/readyz` check, a batch through the deployed API and the demo content on hosted are not done. One small batch (8 questions) was run against the real Claude API through the real prompt and validator, with no database; the full path against the live API and hosted has not been run.)*

---

## Phase 13. Launch

1. [ ] Internal pilot: staff families at one school use it free for 4 weeks; fix what they find.
2. [ ] Paid pilot: one school, one term, all three stages (or the strongest one first), real payments with Evans's approval.
3. [ ] Measure: share of eligible parents who buy (by stage); paying children practising at least 3 days a week; renewal next term; refunds and reasons; parent rating of practice, guides, report and pack; teacher hours per week spent approving drafts; cost per school.
4. [ ] Go/no-go for more schools based on renewal and margin, not sign-ups.
5. [ ] Price review: what uptake and renewal justify moving towards GH₵100, and whether JHS should cost more than Primary.

## Build order

Phases 2–6 make the product worth paying for; build them first on the demo school with hand-granted passes (Phase 7 without payments). Phase 2 is school-grounded (term material, grounded drafting) with a one-click Plan learning that drafts the plan and the practice for a weak topic. Then phases 4–6 (daily plan, parent guides, end-of-term report), then phase 13 step 1 (free staff pilot; ask parents the five questions), then phases 7–9 (payments, revenue share) once the Phase 1 decisions are made, then phases 11–12 hardening. Each slice: tested, loaded into the Sunrise demo, walked through per role, pushed; STATUS.md updated and items ticked here.

Approval needed from Evans before: hosted migrations, running the hosted demo loader, any payment provider or real money, contacting real schools or parents, buying or licensing content, pictures or audio.

## Progress and where to resume

- **Direction decided 2026-10-15 (MEMORY.md):** school-grounded content, no central catalogue. Slices 2a and 2b (migrations 046–048) are on hosted and parked.
- **Next, slice 2c (new):** term material (pasted, per class, subject and term, versioned, private to the school) and grounded drafting with citations, worksheet and question set first. The per-school AI switch, cap and run log already exist.
- **Then:** Plan learning in one click (the plan, the practice for the weak topic, what the child will get at home, a printable test for children without a phone).
- **Then:** measurement: marks before and after on the next tagged class test, the teacher's "not what we taught" flag, and an end-of-term view of practised topics beside results (wording never claims the app caused a change).
- **Open for Evans:** whether parents may see numbers (needed before the parent report); whether the stage-first proposal above is accepted; whether the parked central library should be removed (needs his go-ahead); teacher approval of Claude's drafts stays as the current rule unless he says otherwise.
- **Small open item:** the labelling-word check blocks words like "disorder" or "syndrome" even in JHS science; probably a warning for JHS. It matters again because the checks module is reused for school drafts.
