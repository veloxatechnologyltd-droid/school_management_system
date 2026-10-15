# Home Learning Pass: parent-paid plan and checklist

Status: proposal for review, 2026-10-15. Nothing here is built unless marked "exists". Prices, uptake and revenue shares are unvalidated.

## 1. The promise

Parents pay per child, per term (launch price GH₵50; build the value to justify up to GH₵100, and raise the price only once uptake and renewal give evidence) for learning their child does at home, on the parent's phone or on paper. Reports, bills, notices, the progress view and basic home practice stay free for every family.

**Parent test.** Before launch, each stage must pass all five, judged by real parents, not by us:

- [ ] **Enough:** the child has something useful to do every school day of the term and never runs out.
- [ ] **Right level:** practice targets this child's weak topics, not generic content.
- [ ] **Parent can help:** a parent who doesn't know the topic can still guide the child.
- [ ] **Visible results:** at term end the parent sees what changed, in numbers and plain words.
- [ ] **Worth more than the alternative:** parents compare it favourably with what they already pay for, such as extra classes, lesson teachers or past-question books. Check those local prices; don't assume them.

## 2. Shared foundation (all stages)

### Pass and access
- [ ] Term pass per child: start, end, status (active, expired, refunded); history never changed or deleted.
- [ ] Every paid feature is checked on the server; the free tier never breaks when a pass expires.
- [ ] The headteacher's switch decides whether the school offers the pass (home practice switch exists).
- [ ] Sibling discount (e.g. second child at a reduced price): decide and test.
- [ ] Pass bought in week 1 of term or later: full price or pro-rata? Decide.

### Payments
- [ ] Mobile-money checkout (MTN, Telecel, AirtelTigo) through one provider; payment confirmed only by verified webhook.
- [ ] Payment receipt to the parent by SMS and in the portal.
- [ ] Safe retries: a double tap or slow network never charges twice.
- [ ] Refund path with a reason (e.g. within 14 days, or the school withdraws the pass).
- [ ] Renewal reminder before next term; no automatic debit without consent.
- [ ] Merchant of record decided (us or the school), with tax treatment confirmed.

### School revenue share
- [ ] Ledger per school per term: revenue, payment fees, cost-recovery threshold, 50/50 split above it.
- [ ] School statement shows counts and amounts only, never which parents paid or didn't.
- [ ] Payout by mobile money or bank, with an audit record.
- [ ] Written agreement template for schools.
- [ ] Rule against pressuring parents, written into the agreement.

### Practice engine (extends what exists)
- [ ] Levels engine exists (3 levels, up at 4 of 5, down after two weak sessions). Decide whether paid children get more levels per topic (e.g. 5).
- [ ] Question banks large enough that a child at any level sees no repeat for at least two weeks.
- [ ] Spaced review: topics already passed come back briefly so they aren't forgotten.
- [ ] Daily plan: "Today: 2 sessions, about 10 minutes" chosen automatically from weak topics and review.
- [ ] Streaks and stars, with no leaderboards between children.
- [ ] Works on a cheap Android phone on 3G: small pages, few images, resumes after a dropped connection.

### Parent help
- [ ] "How to help at home" for every topic offered: what the child is learning, one worked example, common mistakes, a 5-minute activity with things in the house. Teacher-approved before parents see it.
- [ ] Audio version of each guide (text-to-speech in English first; local languages only with human review).
- [ ] Weekly SMS or portal message: what your child practised, what's next.

### Proof of progress
- [ ] End-of-term parent report per child: sessions done, topics and levels gained, class marks before and after on those topics, attendance, the teacher's note. Printable.
- [ ] Mid-term check-in message: on track or needs more practice.
- [ ] Honest wording: practice and progress together, never "the app raised your child's score".

### Printable weekly pack
- [ ] PDF per child per week, built from their weak topics, with an answer page for the parent.
- [ ] Prints well on one A4 sheet, black and white.
- [ ] School can print packs for families without smartphones (does the school charge, or include it in the pass?).

### Content production and quality
- [ ] Claude drafts in batches (20–30 questions per topic per level); a named teacher approves. The approval flow exists for small sets.
- [ ] Every question maps to a curriculum strand and indicator, so it shows up on Gaps and in reports.
- [ ] Original questions only. No copying of WAEC papers, textbooks or other publishers without written rights.
- [ ] Error reporting: a parent or teacher can flag a wrong answer; the question is withdrawn until it is fixed.
- [ ] Content coverage target per stage before selling it (see each stage).

### Privacy and safety
- [ ] No adverts and no selling of data. Child data is used only for that child's learning and school reports.
- [ ] No child accounts; everything runs on the guardian's account (exists).
- [ ] Screen-time guidance in the app: short sessions with a parent nearby.

## 3. Lower Primary (Basic 1–3): picture and game learning

**Promise:** "Help your child read and count with confidence, in 10 minutes a day."

### Game types
- [ ] Tap the picture (word, letter, object).
- [ ] Count and choose (1–20, then to 100).
- [ ] Listen and choose: audio plays and the child taps the match.
- [ ] Match pairs: picture–word, number–quantity, capital–small letter.
- [ ] Drag to sort: bigger/smaller, odd/even, living/non-living.
- [ ] Make the amount with cedi coins and notes.
- [ ] Missing letter or number in a pattern.
- [ ] Read-aloud mode: the parent listens to the child read a short sentence and taps "read well / needs help".

### Assets
- [ ] Picture library of 200–300 simple, light drawings with local context (names, foods, animals, money, transport). Rights owned or licensed.
- [ ] Audio on every question and instruction; the child never needs to read the instructions.
- [ ] Phonics sound set recorded or generated once, checked by a teacher.

### Coverage before selling
- [ ] Literacy: letter sounds, blending, sight words, short sentences, B1–B3.
- [ ] Numeracy: counting, place value, addition and subtraction, early times tables, money, shapes, time.
- [ ] At least 8 weeks of daily sessions per class without repeats.

### Parent value
- [ ] Reading level and number level shown simply ("reads 3-letter words", "adds to 20").
- [ ] Bedtime reading card each week (printable short story with questions).

## 4. Upper Primary (Basic 4–6): topic mastery and exams

**Promise:** "Weekly practice on the exact topics your child finds hard, and ready for end-of-term exams."

- [ ] Question types: multiple choice, number answer, multi-step worked problems with hints, short reading passages with questions.
- [ ] Hint and worked-solution step after a wrong answer (teaches, not just marks).
- [ ] Subjects: Maths, English, Science first; then Social Studies or RME if demand shows.
- [ ] End-of-term exam practice: a timed mixed paper per subject in the last 3 weeks of term.
- [ ] Times-table and mental-maths speed drills.
- [ ] Reading comprehension with vocabulary, at the child's level.
- [ ] B6: "Ready for JHS" check covering core Maths and English.
- [ ] Coverage before selling: every Maths and English topic for the term, B4–B6, at 3 levels.

## 5. JHS (JHS 1–3): BECE preparation

**Promise:** "BECE practice with mock scores, so you know where your child stands, every term."

- [ ] BECE-style questions written originally, by subject and topic; no copied WAEC papers without rights.
- [ ] Topic drills with worked solutions.
- [ ] Timed mock papers per subject, scored; the trend is shown across mocks.
- [ ] Target per subject (set by the parent with the teacher) and progress toward it.
- [ ] Weak-topic plan after each mock: the next 2 weeks of drills chosen automatically.
- [ ] Essay and composition prompts with a marking guide for the parent (AI feedback only after a quality review).
- [ ] Countdown and revision plan in JHS 3.
- [ ] Coverage before selling: core subjects (Maths, English, Integrated Science, Social Studies) across JHS 1–3 topics; at least 4 mocks per subject per year.

## 6. Nursery and KG

- [ ] Free: play activities and early-years notes for parents. No paid pass at launch.
- [ ] Revisit only if parents ask for it.

## 7. Launch order

1. [ ] **Demand test:** "reserve your pass" card with a stage-specific message at one pilot school; count reservations by stage.
2. [ ] **Pass and access** on the demo school, with no real money.
3. [ ] **Lower Primary games v1:** 3 game types, 60 pictures, audio, one numeracy and one phonics topic for B1.
4. [ ] **Parent guides and the daily plan** for the topics that exist.
5. [ ] **End-of-term parent report.**
6. [ ] **Upper Primary worked hints and exam papers.**
7. [ ] **JHS drills and mocks.**
8. [ ] **Printable weekly pack.**
9. [ ] **Payments and the revenue-share ledger** (needs Evans's approval and provider set-up).
10. [ ] **Paid pilot:** one school, one term; measure uptake, completion, renewal and parent ratings.

Each slice runs on the Sunrise demo school, is walked through as parent, teacher and headteacher, and is tested before it is pushed.

## 8. Success measures for the paid pilot

- [ ] Share of eligible parents who buy (by stage).
- [ ] Share of paying children practising at least 3 days a week.
- [ ] Renewal rate the following term (the real test of value).
- [ ] Refund requests and their reasons.
- [ ] Parent rating of each piece: practice, guides, report, printable pack.
- [ ] Teacher time spent approving content per week.

## 9. Decisions for Evans

- [ ] Price: GH₵50 per child per term at launch for all stages. Review after the paid pilot: what uptake and renewal justify a rise towards GH₵100, and whether JHS should cost more than Primary.
- [ ] Charge per child, and the sibling discount.
- [ ] Merchant of record and payment provider.
- [ ] Cost-recovery threshold and the 50/50 split, in a written school agreement.
- [ ] Who makes the picture library (in-house, commissioned, licensed).
- [ ] Which pilot school, and whether to start with Lower Primary or JHS.
