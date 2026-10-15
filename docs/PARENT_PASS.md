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
| Enough | **Not met.** A child gets at most three weak topics, 2 sessions a topic a day, from one school-approved set of 5–8 questions per level, so a topic runs dry in days. | Questions generated from every approved topic, enough per level that a child does not run out (phase 2), then the daily plan and no-repeat window (phase 4). |
| Right level | **Partly.** Weak topics come from the school's tagged class work, with three levels and simple up/down rules. | Mastery per indicator and spaced review (phase 4). |
| Parent can help | **Not met.** No parent guide exists for a parent to read. | Guides generated from the approved topics and shown in the portal (phase 6), with audio. |
| Visible results | **Not met.** Parents see topic, level and sessions only; no report. Whether parents may see numbers is an open decision for Evans. | End-of-term report (phase 6), after that decision. |
| Worth more than the alternative | **Not tested.** No local prices checked, no parent asked. | Price research and the internal pilot (phases 1 and 13). |

**The constraint is now the quality of content nobody reads item by item (working figures, to validate).** Teacher time is small: approving the term's topics once. The risk moves to wrong answers and drift in generated content, which the automatic checks catch for sums and structure but not for facts in English, Science or Social Studies. The safeguards in phase 2 (wrong-answer button, audit sample, label) exist for that. In the pilot, measure wrong-answer reports per 1,000 questions, the audit-sample error rate and how often a topic could not be taught, and set a go/no-go threshold before widening.

**Agreed direction (Evans, 2026-10-15):** what a child learns comes from the school's own approved topics; the teacher approves the topics once and Claude then makes the lessons, questions and each child's plan with no per-item approval; no central catalogue and no central review team (MEMORY.md).

**Which subjects and classes (Evans, 2026-10-15):** whatever subjects the school adds material for, not a fixed pair. The earlier proposal to start with Upper Primary Maths and English is withdrawn. What does limit the order is the question types: text-only questions (multiple choice, number) work for any subject and class today; Lower Primary games that need pictures and audio, and JHS timed papers and passages, arrive with phase 3. Run the first version free with staff families at one school (phase 13, step 1) and ask parents the five questions above before any payment work (phases 7–9).

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
- [ ] Children and AI: Anthropic's terms for a service used by under-18s confirmed in writing; the Data Protection Act position on children's chat data and parental consent wording; the retention rule for stored conversations confirmed (a parent can clear at any time; automatic deletion after the term plus 90 days is a working figure). **Deferred by Evans (2026-10-15): leave for now; it does not block the build, but it must be settled before any child uses the chat.**
- [ ] Parent terms and notices say that lessons and questions are made by AI from the school's topics and can contain mistakes, with an easy way to report one.
- [ ] School material terms: material a school adds is private to that school, never shown to another school and never used to train models; Anthropic's API terms (no training on inputs, retention) confirmed in writing before real school material is sent.
- [ ] Price, sibling discount, mid-term purchase rule (full price or pro-rata) and refund window agreed.
- [ ] Support ownership: who answers parents, by which channel, in which hours.

**Done when:** each item has a written decision in MEMORY.md and signed documents where needed.

---

## Phase 2. School-grounded content (the product's foundation)

**Direction (Evans, 2026-10-15): what a child learns comes from what their own school teaches this term, with one teacher approval.** At the start of term the teacher adds the term's topics (the curriculum) and approves them. That is the only approval. From the approved topics Claude creates the lessons, the practice questions and each child's learning plan; no teacher reads or approves each item. Along the way a teacher can add a note for one particular student, and Claude uses it to help that student. There is no central catalogue and no central review team. A central library was built first (slices 2a and 2b, below); it is parked and not on this path.

Why: a child taught something the school has not covered gains nothing in the end-of-term exam, parents stop paying, and a central list cannot know each school's pacing, books or scheme of work. Schools already enter their own indicators and tag class tests to them **(exists)**. Claude never leaves the approved topics, so the approved list is the guard on scope. A child must be able to learn at night with no teacher awake, so nothing waits on a teacher after the topics are approved.

### Approved topics (the one teacher approval)
- [ ] A teacher or the headteacher adds the term's topics per class and subject and approves them. The school's curriculum indicators, pasted in Settings with a source note, are the topics **(exist)**; approving them for the term makes them the scope Claude may teach. Optional: the scheme of work, lesson notes or textbook extracts per topic for Claude to draw on (pasted first; files and photos later).
- [ ] Claude teaches only inside the approved topics, at the class level: lessons, questions and plans never go past a topic's wording. A request outside them gets "that is not in this term's topics: ask your teacher".
- [ ] Private to the school: never shown to another school, never used to train models; a school-scoped table with row-level security **(pattern exists)**. The school confirms it may use what it adds. Versions are append-only; size limits with a clear message, no silent cutting.
- [ ] The teacher can retire a topic, or any generated item, at any time (approval by exception); it stops being served at once.
- [ ] Home practice question sets currently need a teacher's approval per set **(exists)**. That step is retired for sets generated from approved topics; sets a teacher writes by hand stay as they are.

### A note for one student
- [ ] A teacher can add a dated learning note for one student ("use money examples", "short sentences", "weak on carrying", "extra on tenses this month"); append-only and withdrawable. Claude uses it when making that student's plan, lessons and chat replies.
- [ ] Only this learning-note field is used, with no name. There are no health notes in this feature (decided by Evans, 2026-10-15), and the existing learner notes, which have a health category, are never sent to Claude **(rule exists)**. Whether the parent sees these notes is a decision for Evans (recommended: yes, they are about their own child and help at home).

### Generated content, with safeguards instead of per-item approval
- [ ] Claude generates short lessons, practice questions, parent guides and each child's plan from the approved topics through the existing AI layer **(exists: kill switch, school switch, monthly cap, run log without text)**, within the school's cap. No learner data goes to the model **(rule exists)**; only the topic, the class level, a coarse level for the child and the student's learning note.
- [ ] Automatic checks on every question before a child can see it: number answers worked out by the computer, exactly one right answer, no repeats, labelling words, reading level for the stage, and wording that stays inside the topic **(the checks module exists, built for the central library; reuse it)**. These cannot verify facts in subjects like English or Science, which is why the next three items exist.
- [ ] A "this looks wrong" button for the child and the parent on every lesson, reply and question: the item stops being served at once, the teacher is told, and the other items on that topic are checked again.
- [ ] Generated lessons and questions say "Made by AI from your school's topics" so a paying parent is never misled.
- [ ] **Teachers can check what Claude teaches (Evans, 2026-10-15):** at any time a teacher can read everything generated for their classes, per topic: the lessons, the practice questions with their answers, the parent guides and each child's plan, with the topic and notes they came from, and can retire or flag any of it. Checking is optional: nothing waits for it.
- [ ] A monthly audit by Evans through the super admin page (phase 11): a random sample of generated items per school (working figure: 5%), each shown with the topic it came from and marked right or wrong. Target: no confirmed wrong answer. A confirmed error means the item is retired and regenerated and its topic is checked again. The wrong-answer report rate and the audit-sample error rate are measured in the pilot before widening.
- [ ] Enough questions per topic and level that a child does not run out (working figure: 20 per level, about two weeks without repeats), generated when the topic is approved.

**Done when:** a teacher adds and approves a term's topics for one class and adds one note for one student. With no further teacher action each child gets a plan from their class marks and the notes, and can pick any approved topic at night and either practise it or study it with Claude (lesson, then questions). A topic outside the approved list is refused, and a flagged item disappears at once.

### Media
- [ ] Pictures and audio arrive with the question types in phase 3 and need object storage (none exists today). Not needed for text-only questions.

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

- [ ] **The child picks a topic, then chooses Practice or Study (Evans, 2026-10-15):** any topic the teacher approved for the term, in any subject the school uploaded (for example History, fractions, pollination), whether it is a weak topic from class work (*Improve from my class work*, as home practice does today **(exists)**) or something they want to learn on their own. Learners have no logins, so the choice is made on the parent's phone inside the child's profile, at any hour, with no teacher awake or involved.
- [ ] **Practice** runs questions made from the approved topic, with the levels and rules we have **(exists)**.
- [ ] **Study** teaches the topic in plain words at the child's class level and how the child is doing on it (a coarse level, never a name or marks sent to the model), then lets the child ask questions in a chat; see "Study with Claude" below.
- [ ] **Each child's learning plan is made by the system, not by a teacher:** from the approved topics, the child's class marks (weak topics first) and any note a teacher added for that student. No teacher click is needed. The teacher's own support plans for classroom actions **(exist)** stay a separate teacher tool.
- [ ] Self-chosen practice and study are evidence beside class marks, never part of CA or report scores **(rule exists for home practice)**; the parent and the teacher can see what the child chose and how it went. Performance is tracked from practice, from the check questions inside Study and from time on a topic; clearing a chat never removes it.
- [ ] Mastery per child per indicator, from practice and the school's class marks **(class marks exist)**.
- [ ] Levels per indicator (keep 3 **(exists)** or extend per stage; decide).
- [ ] No-repeat window: a child doesn't see the same question for 14 days while others are available.
- [ ] Spaced review: passed indicators come back briefly after 1, 3 and 6 weeks.
- [ ] Daily plan: "Today: 2 sessions, about 10 minutes", from weakest indicators plus due reviews; adjustable by the parent (lighter or heavier).
- [ ] Limits: sessions per topic per day **(exists: 2)** and a daily total, so screen time stays short.
- [ ] The plan follows the school's term: indicators taught recently come first.
- [ ] Teacher-set focus: a teacher's note or support plan **(support plans exist)** for a student puts that topic at the top of the child's plan.
- [ ] Streaks forgive one missed day; no punishment for missed days.
- [ ] All rules in one module with unit tests, like `practice/rules.ts` **(exists)**.

### Study with Claude (the child's chat tutor)
Built last in this phase, behind its own headteacher switch (off by default, like home practice) and an evaluation. The lesson and the chat replies are both made by Claude from the approved topics and are not reviewed item by item, so the safeguards in phase 2 stand in for approval, and the chat adds its own. This reverses the 2026-10-14 decision to reject a learner-facing chatbot, which was about learners using phones in school; this is at home on the parent's phone.
- [ ] **It acts as a teacher (Evans, 2026-10-15), not an answer machine.** It explains step by step in easy words at the child's class level, with a local example. It checks understanding by asking the child a short question and waits for the answer, corrects gently and praises effort. When a child asks for the answer to a practice question it asks guiding questions first. It slows down and simplifies if the child struggles and goes a little further, inside the topic, if the child is comfortable. It ends with a short recap and offers practice. It is patient and never shames.
- [ ] The check questions Claude asks inside Study count as performance (see below).
- [ ] Replies are short and in easy words for the child's class (reading-level limits as for questions), with a local example where it helps, and they stay inside the approved topic and the notes the teacher added for it. They use the student's learning note, if any, to pitch the explanation.
- [ ] When the question is outside the topic, Claude says so and suggests asking the teacher. It does not teach other subjects and does not hold personal conversations.
- [ ] No name, admission number, school name or contact detail goes to the model; the child is not asked for any; anything the child types that looks like personal data is not stored.
- [ ] A child who writes something worrying (hurt, fear, abuse) gets a kind fixed reply and the parent is told; Claude does not handle it alone.
- [ ] "This answer looks wrong" button on any reply: the item stops being served, the teacher is told, and the topic is checked again.
- [ ] Limits: replies per child per day, a short conversation length, a per-school cost cap, the existing AI kill switch and school switch **(exist)**.
- [ ] **The teacher sees each student's performance from their own screen** (Evans, 2026-10-15): topics studied and practised, time on each, how many questions the child asked, results on practice and on the check questions, and anything flagged, on the learner page and the class view beside home practice **(exist for practice)**. The teacher does not see the words of the chat by default (whether a teacher can read a conversation that a child or parent flagged is not decided; recommended: yes, flagged conversations only). Across the class, the questions a topic could not answer are listed so the teacher knows what to add.
- [ ] **Parents can read their child's study conversations and can clear them (Evans, 2026-10-15).** Clearing deletes the words from the server; the performance record stays (topic, date, minutes, number of questions asked, practice and check results, flags), so the child's progress is still tracked. A conversation a parent never clears is deleted automatically after the term plus 90 days (working figure, to confirm).
- [ ] Evaluation before any child can use it, extending `npm run ai:eval`: off-topic requests, instructions hidden in a question, a wrong premise, a question beyond the topic, personal disclosures, rude or sexual content, a request to do the homework. All handled as specified.
- [ ] Measure: marks on the next tagged class test for topics a child studied, and practice scores after studying (never claiming the app caused a change).

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
- [ ] Today screen per child: today's plan, streak, last result, one line from the teacher if any, and the child's choice: pick a topic (any approved topic in the school's subjects, with the weak ones from class work marked), then Practice or Study.
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
- [ ] Teacher can flag any generated item "not what we taught" or wrong; it stops being served at once.
- [ ] The teacher approves the term's topics once, can read everything generated for their classes, can retire a topic or any generated item at any time, and can add a note for one student; lessons, questions and plans are not approved item by item.
- [ ] Headteacher settings: offer the pass, school printing option, who may add term material.

---

## Phase 11. Platform operations

- [ ] **Super admin page (Evans, 2026-10-15): one place to track everything, across all schools.** Per school: topics approved, items generated and retired, AI runs and tokens against the cap, wrong-answer reports and their status, audit samples and the error rate, study and practice sessions, children active, performance summaries, counts of worrying-message alerts and whether each was handled (never the words), and later passes, payments and the revenue-share ledger. Evans can open any school and read what Claude generated for it **(platform admin entry exists)**. The monthly audit sample queue lives here.
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

- [ ] Child chat evaluation passes (phase 4, Study with Claude) before the switch can be turned on for any school.
- [ ] Unit tests: every validator, learning-engine rule, price and revenue-share calculation. *(Slice 2a: content body validators and the automatic checks are covered; learning-engine, price and revenue-share rules do not exist yet.)*
- [ ] API tests: pass checks, payment webhooks (valid, forged, repeated, out of order), refunds, school isolation, guardian rights.
- [ ] Browser tests per stage: buy (simulated), play each question type, daily plan, guides, report, printable pack; at 390 px and 1440 px.
- [ ] Real-device test on a low-end Android phone over 3G.
- [ ] Load test: 2,000 children practising in the same evening hour across schools.
- [ ] Pilot measures on generated content (wrong-answer reports per 1,000 questions, error rate in the audit sample, items teachers retire, topics the notes could not teach) and a sign-off per stage on the parent test.
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

Phases 2–6 make the product worth paying for; build them first on the demo school with hand-granted passes (Phase 7 without payments). Phase 2 is school-grounded (term material, grounded drafting) with a one-click Plan learning that drafts the plan and the practice for a weak topic, and two ways for the child to choose what to learn (improve from class work, or on their own). Then phases 4–6 (daily plan, parent guides, end-of-term report), then phase 13 step 1 (free staff pilot; ask parents the five questions), then phases 7–9 (payments, revenue share) once the Phase 1 decisions are made, then phases 11–12 hardening. Each slice: tested, loaded into the Sunrise demo, walked through per role, pushed; STATUS.md updated and items ticked here.

Approval needed from Evans before: hosted migrations, running the hosted demo loader, any payment provider or real money, contacting real schools or parents, buying or licensing content, pictures or audio.

## Progress and where to resume

- **Built and live on hosted:** home practice (school-approved question sets) and the Progress and learner pages; Claude drafts for teachers (worksheets, question sets, support plans, report remarks) and the Ask assistant; the parked central library (slices 2a and 2b, migrations 046–048, drafting budget 0).
- **Decisions so far (2026-10-15, MEMORY.md):** school-grounded content, no central catalogue; the teacher approves the term's topics once and nothing else; Claude makes lessons, questions and each child's plan with safeguards instead of per-item approval; the child picks a topic, then Practice or Study; Study is a chat that acts as a teacher, built last behind a headteacher switch and a safety evaluation; parents can read and clear the chat while the performance record stays; teachers see performance and can read everything generated for their classes; no health notes; Evans tracks everything and does the audit through a super admin page; the terms for children are deferred by Evans.
- **Proposed slices, one at a time** (tests first, loaded into the Sunrise demo, walked through per role at desktop and phone width; hosted migrations and pushes only with Evans's approval):
  1. **Approved topics and generation.** A term approval on the school's curriculum indicators. Claude generates a lesson and levelled practice questions (working figure: 20 per level) for each approved topic, with the automatic checks, school-scoped append-only storage, the AI label, a teacher content view per topic with retire-at-once, and a "looks wrong" flag from the parent. Reuse: `curriculum_indicators` (migrations 035 and 037), `practice_sets` and `practice_questions` (044), the AI layer (`ai_settings`, `ai_runs`, caps, `AnthropicProvider`), and `backend/src/modules/content/checks.ts` and `drafting.ts` (checks, prompt, validator, tag neutralisation, unstorable characters) built for the parked library.
  2. **Home practice from generated questions.** Retire the per-set teacher approval for generated sets (hand-written sets stay as they are); the child's topic picker with Practice.
  3. **Study lesson without the chat.** A lesson page per approved topic with check questions that count as performance.
  4. **A note for one student.** Teacher-authored learning note, no name, no health content, used by the plan and lessons.
  5. **Super admin tracking page and the audit queue.**
  6. **The study chat** (teacher persona), behind a headteacher switch and the safety evaluation; parents read and clear; flagged conversations.
- **Open for Evans:** whether parents see the notes a teacher adds for a student (recommended: yes); the automatic-deletion period for chats a parent never clears (working figure: the term plus 90 days); whether a teacher can read a flagged conversation (recommended: yes); whether parents may see numbers (before the parent report); whether the parked central library should be removed (needs his go-ahead). **Deferred by Evans:** Anthropic's terms for a service used by children and the data-protection position; settle before any child uses the chat.
- **Small open item:** the labelling-word check blocks words like "disorder" or "syndrome" even in JHS science; probably a warning for JHS. It matters because the checks module is reused for generated content.
- **Working notes for a new session:** stop `dev:demo` before `npm run test:browser` (stop it by process group, never `pkill -f`); backend tests and browser specs share one database per run, so use unique codes and leave shared queues as found; editing an unapplied migration needs `school_saas_template` dropped and `npm run demo:reset`; use a Claude stand-in (`e2e/claude-standin.mjs`) for local walkthroughs, because `.env` holds a real key; the hosted migration runner is `npm run db:migrate:supabase` (preview) and `-- --apply` and needs Evans's explicit say-so each time.
