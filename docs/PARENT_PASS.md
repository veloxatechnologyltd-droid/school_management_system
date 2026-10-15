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

---

## Phase 1. Decisions and legal (blocks launch, not building)

- [ ] Merchant of record: the platform collects and pays schools their share (recommended), or the school collects and is invoiced.
- [ ] Payment provider chosen (Paystack, Hubtel or another Bank of Ghana–approved provider); fees, settlement times and payout method confirmed in writing.
- [ ] Company registration, tax treatment of pass income and of school payouts confirmed with an accountant.
- [ ] Registration and duties under Ghana's Data Protection Act confirmed (current requirements, not assumed), including processing children's data with guardian consent.
- [ ] Parent terms of service: what the pass includes, term dates, refund rules, what happens if the child changes school.
- [ ] Privacy notice for parents in plain English: what is collected, why, who sees it, how long it is kept, no adverts, no data sales.
- [ ] School agreement: revenue share, cost-recovery threshold, payouts, no-pressure rule, school's duties (teacher sign-off where needed), ending the agreement.
- [ ] Content rights policy: original questions only; no WAEC papers, textbooks or publisher material without written rights; ownership of commissioned pictures and audio.
- [ ] Price, sibling discount, mid-term purchase rule (full price or pro-rata) and refund window agreed.
- [ ] Support ownership: who answers parents, by which channel, in which hours.

**Done when:** each item has a written decision in MEMORY.md and signed documents where needed.

---

## Phase 2. Shared content library (the product's foundation)

Today's question banks are per school **(exists: `practice_sets`, `practice_questions`, approved by a school teacher)**. A sellable product needs content written once, reviewed centrally and used by every school.

### Data
- [x] Platform curriculum catalogue (no `school_id`): subject, class level (Basic 1–JHS 3), strand, sub-strand, official indicator code, description, term guidance, with origin (`official` or `platform`) and a source note on every entry; a lead adds and retires entries, wording is never edited. **Built, slice 2a (migration 046).** Schools get a read path with the matching screen below; the platform ships no NaCCA text until redistribution rights are confirmed.
- [ ] Matching school indicators to catalogue entries: automatic by official code where `origin = 'official'` **(field exists)**, plus a headteacher screen to match or skip the rest.
- [ ] Platform content items: question, guide, picture, audio, passage, mock paper; each versioned and append-only, with status draft → in review → published → retired (with reason). **Questions and parent guides built (slice 2a): a draft can be reworded by its author until submitted, then the version is frozen; a fix is a new version, and publishing it retires the previous live one. Picture, audio, passage and mock paper come with media.**
- [x] Every content item records its catalogue indicator, stage, level, author (person or AI run) and named reviewer. **Stage comes from the indicator's class level; `author_kind` and `ai_run_id` are ready for Claude drafts.**
- [ ] School-local sets keep working **(exists)** and sit beside platform content; a school can hide a platform item for its own children with a reason.

### Roles and workflow
- [x] Platform roles: content author, content reviewer, content lead (separate from school roles and from platform admin). **Granted by the platform administrator in its Content team section; a published version always has a reviewer who is not its author, enforced in the database; content roles use the second sign-in step where it is required.**
- [ ] Claude drafts in batches (20–30 questions per indicator per level) through the existing AI layer and its run records **(exists: `ai_runs`, monthly caps)**; nothing reaches children without a named human reviewer.
- [x] Review screen: question as the child sees it, answer, explanation, audio, picture; approve, edit as a new version, or reject with a reason. **Built for questions and guides (audio and picture when media exists).**
- [x] Automatic checks before review: answer correct for number questions, no duplicate or near-duplicate prompts, reading level within stage limits, banned wording ("all of the above", diagnosis or ranking language), picture and audio present where the question type needs them. **Built, slice 2a: a question that is a plain sum has its answer worked out by the computer (fractions and story problems are left to the reviewer); exact repeats and labelling language block a submit, near repeats and reading level warn; limits are working figures. Picture and audio checks wait for media.**
- [ ] Error reports from parents and teachers ("this answer looks wrong"): item is withdrawn from new sessions at once, reviewed within 48 hours, fixed as a new version.
- [ ] Sampling QA: reviewers re-check a random 5% of published items each month.

### Media
- [ ] Object storage with a CDN for pictures, audio and PDFs (none exists today); private buckets for child-specific PDFs, signed short-lived links.
- [ ] Picture library: 200–300 simple SVG drawings at launch, Ghanaian context (names, foods, animals, money, transport, school things), each with tags and rights record.
- [ ] Audio: text-to-speech generated once per published item, stored, checked by a reviewer; regenerated when the item's wording changes; recorded human audio for phonics sounds.
- [ ] Size budgets: picture ≤ 15 KB, audio ≤ 40 KB per question, a whole 5-question session ≤ 300 KB on first load.

### Coverage targets before each stage is sold
- [ ] Every core indicator of the term covered for each class in the stage (Lower Primary: literacy and numeracy; Upper Primary: Maths, English, Science; JHS: Maths, English, Integrated Science, Social Studies).
- [ ] At least 60 published questions per indicator (20 per level), enough for two weeks without repeats.
- [ ] A parent guide for every covered indicator.
- [ ] JHS: at least 4 mock papers per core subject per year.

**Done when:** a content lead can draft, review, publish, withdraw and fix items end to end; two schools on different indicator lists both receive the same platform content.

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
- [ ] Teacher can flag a platform question as wrong or unsuitable.
- [ ] School-local questions keep the existing approval flow **(exists)**.
- [ ] Headteacher settings: offer the pass, school printing option, hide a platform item with a reason.

---

## Phase 11. Platform operations

- [ ] Monitoring and alerts: API errors, webhook failures, payment mismatches, worker jobs, storage and CDN errors.
- [ ] Production hosting on paid plans: API not sleeping, worker running (Render free plan and disabled worker noted in STATUS.md must change).
- [ ] Backups with a tested restore; payment and pass records included.
- [ ] Product analytics with no personal data: sessions started and finished, plans followed, drop-off points, renewal.
- [ ] Cost tracking per school per term: hosting, storage, SMS, AI, payment fees.
- [ ] AI spend caps per school and platform-wide **(per-school cap exists)**; content drafting runs on the platform's own budget.
- [ ] Support inbox: parent questions, refund requests, wrong-answer reports; response targets.
- [ ] Incident runbook: payments down, content error published, data exposure.
- [ ] Security review before launch: payment routes, webhooks, pass checks, school isolation of all new tables (RLS on every school table **(pattern exists)**), platform tables read-only to schools.

---

## Phase 12. Testing and acceptance

- [ ] Unit tests: every validator, learning-engine rule, price and revenue-share calculation.
- [ ] API tests: pass checks, payment webhooks (valid, forged, repeated, out of order), refunds, school isolation, guardian rights.
- [ ] Browser tests per stage: buy (simulated), play each question type, daily plan, guides, report, printable pack; at 390 px and 1440 px.
- [ ] Real-device test on a low-end Android phone over 3G.
- [ ] Load test: 2,000 children practising in the same evening hour across schools.
- [ ] Content QA sign-off per stage against the coverage targets.
- [ ] Sunrise demo school loaded with every feature and walked through as parent, teacher, headteacher and platform admin before each push.
- [ ] Local tests, demo, hosted deployment and school acceptance are reported separately; none stands for another.

---

## Phase 13. Launch

1. [ ] Internal pilot: staff families at one school use it free for 4 weeks; fix what they find.
2. [ ] Paid pilot: one school, one term, all three stages (or the strongest one first), real payments with Evans's approval.
3. [ ] Measure: share of eligible parents who buy (by stage); paying children practising at least 3 days a week; renewal next term; refunds and reasons; parent rating of practice, guides, report and pack; reviewer hours per week; cost per school.
4. [ ] Go/no-go for more schools based on renewal and margin, not sign-ups.
5. [ ] Price review: what uptake and renewal justify moving towards GH₵100, and whether JHS should cost more than Primary.

## Build order

Phases 2–6 make the product worth paying for; build them first on the demo school with hand-granted passes (Phase 7 without payments). Then Phase 8–9 once Phase 1 decisions are made, then Phase 11–12 hardening, then Phase 13. Each slice: tested, loaded into the Sunrise demo, walked through per role, pushed; STATUS.md updated and items ticked here.

Approval needed from Evans before: hosted migrations, running the hosted demo loader, any payment provider or real money, contacting real schools or parents, buying or licensing content, pictures or audio.
