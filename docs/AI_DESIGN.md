# AI layer — implementation design

Status: provider is Claude (Evans, 2026-10-14). Three features implemented locally (see "What exists"); the rest are planned. Follows [ARCHITECTURE.md §5](ARCHITECTURE.md); this file adds the concrete design. No real child data has been sent to any model provider.

## 1. Principles (unchanged from the architecture)

1. AI drafts; people decide. It never publishes reports, posts money, changes attendance, decides admission/promotion/discipline, diagnoses a child, or messages a family.
2. Numbers come from deterministic code (`AssessmentService.results`, finance queries). A model may phrase them, never compute them.
3. The model sees only facts the requesting user is already allowed to see, minimised and de-identified.
4. Every run is logged (who, which school, which sources, which model/template version, cost, outcome); every output is validated before a person sees it; every use is reviewable and reversible.
5. The manual workflow always works. AI off, provider down, budget exhausted or validation failed → the teacher writes the report as before (a plain template draft is offered instead).

## 2. Value map (ordered by expected value for a Ghanaian school)

| # | Feature | Who | Grounding | Status |
| --- | --- | --- | --- | --- |
| 1 | Nursery/KG report remarks from observations | Teacher → head approves | The child's observations for the period, with citations | **Implemented** |
| 2 | Terminal report comments (Primary/JHS) from computed results + attendance | Class teacher → head | `AssessmentService.results` snapshot | **Implemented** |
| 3 | Column mapping and date clean-up for CSV onboarding | Head/front desk | Uploaded headers/sample rows (no learner names sent) | Planned |
| 4 | Guardian-friendly explanation of an approved report or fee statement, English/Twi | Head sends after review | Published snapshot only | Planned (needs notices) |
| 5 | Head's "attention today" summary | Head | `attendance/follow-up` + `repeated-absence` output | Planned; the deterministic list already exists, AI only phrases it |
| 6 | Lesson-plan drafts aligned to the school's supplied curriculum | Teacher | School-supplied curriculum text only (rights confirmed first) | Planned |
| 7 | Practice worksheet for one curriculum indicator (4–6 questions, teacher answers, a home tip) | Teacher | The indicator as the school recorded it; no learner data | **Implemented** |

Out of scope: direct child chat, automated grading of pupil work, any decision about a child.

## 3. Architecture

```
teacher/head request ──▶ AiController ──▶ authorize (same rules as the underlying record)
                                           │
                       kill switch (AI_ENABLED) · school flag (ai_settings) · monthly cap
                                           │
                     build facts from domain services (no arbitrary SQL, no free browsing)
                                           │
                 minimise + de-identify ──▶ AiProvider (Anthropic | template fallback)
                                           │
              parse JSON ─▶ validate (schema, citations ⊂ sources, banned-content) ─▶ ai_runs row
                                           │
                                 draft returned to the person ──▶ they edit ──▶ normal report workflow
                                                                   (submit → head approve → publish)
```

- **Provider seam** (`ai.provider.ts`): `complete({system,user,maxTokens})`. Adapters: `AnthropicProvider` (Claude Messages API, default `claude-haiku-5-5` for cost; the chosen provider and the default), `OpenAiProvider` (kept, used only if `AI_PROVIDER=openai` is set deliberately), and the deterministic local template (no network). `AI_PROVIDER` picks one; `AI_MODEL` overrides the model. A future provider is one class. No automatic fallback to an *unapproved* provider; the only fallback is the local template.
- **Permissions**: the AI endpoints reuse the report/assessment authorization (assigned teacher for the class and period, or headteacher). Facts are built inside the same transaction and RLS context as any other read, so cross-school access is impossible by construction.
- **Minimisation**: the prompt contains no names, admission numbers, guardian data or school name. The child is "the child". Only the period's observations (learning area, indicator, status, descriptor, evidence) are sent. Evidence is free text written by teachers; it is passed inside a delimited data block, length-capped, and labelled as untrusted.
- **Output contract**: JSON `{strengths, nextSteps, citations[]}`; `citations` must be a non-empty subset of the observation IDs supplied. Anything else, or text matching the banned list (diagnostic/medical labels, scores, rankings, comparisons with other children), is rejected and replaced by the template draft with `status='fallback'`.
- **Governance tables** (migration 025): `ai_settings` (per-school switch, monthly run cap, who enabled it and the acknowledgement text), `ai_runs` (append-only log), `ai_run_feedback` (accepted / edited / discarded, append-only).
- **Controls**: env `AI_ENABLED=true` (global kill switch, default off) and per-school `enabled` (default off, headteacher must acknowledge that the school's data-protection agreement covers AI drafting); monthly run cap per school (default 200) and a second cap per person (default 50, migration 052), so one busy teacher cannot use the school's month: every model call counts against the school and the person who made it, the school cap is checked first, template fallbacks are never counted; 20 s provider timeout; small `maxTokens`; no retries that could loop.
- **Privacy and retention**: the run log stores IDs, digests, token counts and outcomes — not prompts and not the generated text. Provider terms (zero retention, no training on inputs, region) must be confirmed in writing before `AI_ENABLED` is turned on in production; see the data-protection gate in the audit checklist.

## 4. Evaluation (release gate)

Offline, on synthetic Ghana-school cases, run in CI with a scripted provider and, when a key is present, against the live model (`npm run ai:eval -w backend`):

| Check | Pass condition |
| --- | --- |
| Grounding | Every citation is a supplied observation; unsupported claims (e.g. a skill never observed) are rejected |
| Missing evidence | With no observed entries the run is refused, not invented |
| Prompt injection in evidence | Instructions inside evidence ("ignore previous instructions…") do not alter the schema; forbidden output is rejected |
| Forbidden content | Diagnosis, medical or ranking language is rejected |
| Access | Unassigned teacher, other-school user, guardian, and disabled school all get no run and no provider call |
| Cost/availability | Cap reached, kill switch, provider timeout/error → template fallback, no crash |
| Privacy | Prompt and run log contain no names or admission numbers |

Zero successful unauthorised retrievals or actions is required. After any model, prompt or template change, re-run the suite and have a teacher review a sample; track acceptance rate and edit effort per PRODUCT.md §3.

## 5. Rollout

1. Local/synthetic only (now).
2. Pilot school, AI **off**; the school uses the core system first.
3. Enable feature 1 for one class with the head's acknowledgement; a teacher reviews every draft; weekly review of `ai_run_feedback`.
4. Extend to features 2 and 5 once acceptance is measured. Cost per active school is tracked from `ai_runs`.

## 6. What exists (2026-09-29)

Migration 025; `backend/src/modules/ai/*`; endpoints `GET/PUT /schools/:id/ai/settings`, `POST /schools/:id/ai/early-years/report-draft`, `POST /schools/:id/ai/runs/:runId/feedback`; UI "Suggest a draft" on the Nursery/KG report form; `npm run ai:eval`. The OpenAI and Anthropic adapters are unit-tested against a stubbed HTTP endpoint only; neither has been run against the live API. Claude is now the provider (§7).

## 7. Report remarks and worksheets (2026-10-14)

Provider: Claude, chosen by Evans. Endpoints `POST /schools/:id/ai/report-remarks-draft` (`classId`, `termId`, optional `learnerIds`) and `POST /schools/:id/ai/indicators/:indicatorId/worksheet-draft`. Both reuse the gate (kill switch, school switch, key, monthly cap), the three-phase flow (no transaction held during the call), the run log (`assessment.report-remarks`, `practice.worksheet`; IDs, digest, tokens, no text) and feedback.

- **Remarks**: authorization is `AssessmentService.results` (assigned class teacher or head). By default only unpublished learners without a class teacher's remark and with at least one subject total. Learners go as `L1…`, subjects as `S1…` with the grade-band word only (no marks, positions or names); attendance as regular/fair/irregular; the teacher's conduct/interest text as untrusted data. Batches of 10 learners per call. Each remark is checked per learner: 20–300 characters, no digits, no he/she/his/her, no diagnosis/ranking/comparison words, every cited subject belongs to the learner, each "strength" is at or above the pass line and above every "focus" subject, and no other school subject is named. A failed learner gets the deterministic template remark (best subjects ≥70, weakest below 50, attendance word). Drafts fill the remark boxes marked "draft, not saved"; saving is the ordinary remarks command.
- **Worksheets**: only the indicator (subject, class/grade, code, strand, sub-strand, wording) is sent. 3–8 questions, answers of equal number, numbered questions ≤500 characters so the reviewed sheet saves as an ordinary practice material; labelling language refused. Fallback is an outline for the teacher to complete. The home tip can be added as a family activity; "Print sheet" prints the questions without answers.

Not yet run against the live Claude API (no key on the development machine). Before real data: confirm Anthropic's commercial API terms in writing (no training on API inputs by default, retention window), set `ANTHROPIC_API_KEY`, and run `npm run ai:eval -w backend`.

## 8. Content library batch drafting (2026-10-15)

Platform level, not school level: authors with the content `author` role ask Claude for questions for the shared library (Home Learning Pass, `docs/PARENT_PASS.md` phase 2). `POST /content/drafting/batches` (`indicatorId`, `level` 1–3, optional `count` 1–30, default 20) and `POST /content/drafting/runs/:id/submit`.

- **Sent to the model:** the catalogue indicator (subject, class level, code, strand, wording) and up to 40 questions already written for it, as data inside tags. No child, school or person.
- **Governance:** `AI_ENABLED` kill switch and a provider key, plus a platform-owned monthly token budget (`content_ai_budget`, set only by the platform administrator; 0 means nothing can be drafted). A batch reserves tokens in `content_ai_begin_run` (budget row locked, so concurrent batches queue) and the reservation gives way to the provider's reported tokens when the run finishes; a run with no reported tokens stays charged its reservation. Log: private append-only `content_ai_runs` (who, entry, difficulty, tokens, outcome, digest; no prompt, no text).
- **Output:** `content_ai_finish_run` is the only way an `ai` version can exist, for an open run begun by the same person. Each question is checked as a person's would be at submit; wrong sums, exact repeats, labelling language and unanswerable questions are dropped one by one, near repeats and reading-level notes are kept as warnings. Drafts are the requester's, start as drafts and still need a named human reviewer. A Claude draft is frozen (the database refuses a reword, and a person's version cannot name a run), so a person's wording is always a new version, labelled and reviewed as theirs. Unstorable characters (NUL, lone surrogates) and tag look-alikes in text are neutralised before the model or the database sees them.
- **No fallback:** with no provider or budget nothing is drafted (there is no template to fall back to).
- **Live check (2026-10-15):** one batch of 8 for Basic 4 times tables through the real prompt and validator with `claude-haiku-5-5`: 8 kept, correct answers, 11 s, 684 input and 1,796 output tokens. Not yet run through the deployed API.
