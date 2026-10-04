Maintain a file called MEMORY.md. After any significant decision, about direction, format, content, approach, or strategy, add an entry:

## [Date], [Decision]
**What was decided:** [the choice made]
**Why:** [the reasoning]
**What was rejected:** [alternatives considered and why they were ruled out]

Read MEMORY.md at the start of every session before doing anything. Never contradict a logged decision without flagging it first.

## 2026-09-28, Compact planning before implementation
**What was decided:** Prepare a Ghana-focused Nursery/KG/Primary/JHS SaaS plan with an SHS extension path and staff-facing AI proposals. Preserve original instructions and existing files. Following Evans's clarification, keep four core specification files and a task-specific agent reading path; implementation awaits review.
**Why:** Ground the product in the demo and current research while limiting agent context and token cost.
**What was rejected:** A large set of overlapping specifications, reading every document each session, starting implementation now, or treating proposed stack/provider choices as approved.

## 2026-09-28, Backend stack accepted
**What was decided:** Evans approved Node.js + TypeScript + NestJS + PostgreSQL for the backend. Use one backend codebase for API and worker processes, with AI integrations inside it initially. This supersedes the earlier FastAPI/SQLAlchemy/Alembic proposal. Implementation remains pending authorization; database tooling and providers remain open.
**Why:** A shared TypeScript language with the proposed React frontend and NestJS module conventions suit the school's operational workflows and initial AI API integrations.
**What was rejected:** Proceeding with the earlier Python backend proposal or introducing a separate Python AI service before a concrete need exists.

## 2026-09-28, Project Codex model routing authorized
**What was decided:** Evans requested installation of the proposed routing setup. Use project-scoped Sol Medium as the main/default agent, Luna High for bounded small tasks, and read-only Astra Medium for critical reviews. Limit spawned agents to two and keep delegation guidance in AGENTS.md. Application implementation still awaits authorization.
**Why:** Balance implementation quality and usage cost while preserving project approval rules and keeping configuration local to this project.
**What was rejected:** Changing machine-wide settings, automatic main-model switching claims, silently upgrading unavailable models, or treating configuration validation as live routing proof.

## 2026-09-28, Implementation and feature pushes authorized
**What was decided:** Evans authorized implementation through P1–P4 with React/TypeScript, NestJS/TypeScript and PostgreSQL, routine decisions, continuous feature checks, and migrations only in dedicated disposable local databases. His subsequent instruction authorizes ongoing verified feature pushes to GitHub. Preserve original instructions and the separate client demo. This supersedes the planning-only authorization state without editing the original instructions.
**Why:** The current explicit goal supplies implementation and local migration authority; the follow-up supplies push authority.
**What was rejected:** Deployment, shared database changes, real messages, invented school approval, or calling local/mocked provider work externally verified.

## 2026-09-28, Local foundation tooling and identity boundary
**What was decided:** Use npm workspaces, pinned dependencies/lockfile, direct node-postgres transactions and reviewed checksum-tracked SQL migrations. Develop on Node 22.22.3 and a private disposable PostgreSQL cluster without a TCP listener. Synthetic local accounts support browser/API checks; managed OIDC/MFA remains a separate unresolved provider gate. Runtime is a non-owner role with FORCE RLS, and commands recheck live membership and CSRF.
**Why:** Explicit SQL supports tenant-inclusive constraints and transaction-local context, while the local identity path permits meaningful workflow tests before provider selection. Patched Nest 11.2.6 and Vite 7.3.6 resolve the initial audit findings.
**What was rejected:** Custom production password recovery, superuser runtime connections, SQLite/mock-only isolation evidence, importing the demo or touching a shared database.

## 2026-09-28, Durable jobs and historical enrolment commands
**What was decided:** Use a separate non-owner worker role with immutable job inputs, leased attempts, bounded retry/dead-letter states and live actor reauthorization. Audit export is the first private job; it sends nothing externally. Admission decisions use explicit transitions and payload-bound transactional operation receipts. Class dates use inclusive starts and exclusive ends; enrolment intervals cannot overlap and completed intervals cannot be rewritten. Capacity checks include scheduled arrivals/departures and headteacher overrides require an audited reason.
**Why:** These invariants provide a verified foundation for later attendance, report, payment and communication commands while preserving tenant boundaries and historical records. Native browser date automation was unreliable, so a Chromium regression suite verifies actual form fills, clicks, reloads and downloads.
**What was rejected:** Treating queued work as completed, retrying unknown operations indefinitely, overwriting class history, ignoring future reservations, treating a synthetic reviewer as school acceptance, or assuming provider approvals from local tests.

## 2026-09-28, Withdrawal preserves scheduled history through supersession
**What was decided:** Dated withdrawal closes effective enrolment with a required reason, optimistic version and transactional retry receipt. When withdrawal precedes a scheduled transfer, mark affected original intervals superseded and create the shortened effective interval; original dates/reasons remain immutable and visible. Capacity and later commands exclude superseded plans. Apply only forward migrations to the disposable local database.
**Why:** A scheduled move must not block an earlier departure or consume cancelled capacity; rewriting already closed history would destroy the record of the reviewed plan. Astra review identified the scheduled-transfer case, then reviewed the correction.
**What was rejected:** Rejecting all earlier departures, deleting planned enrolments, rewriting closed dates, retaining cancelled capacity, or treating local synthetic review as school acceptance.

## 2026-09-28, Reviewed guardian rights and fresh child authorization
**What was decided:** Headteachers create pending guardian links, verify explicitly with reasons and revoke with reasons; rights are separate academic/billing/pickup/contact grants. Replacing rights requires revocation and a new reviewed link. Snapshot guardian identity and retain immutable review history. Guardian list/detail reads recheck live membership and verified unrevoked own links; only academic rights expose birth date and effective class history. Use paged/searchable staff history so old active grants remain manageable.
**Why:** Sponsorship or shared identity does not imply academic or pickup authority. Fresh rights checks and transaction locks serialize revocation with reads. Candidate functions reveal only active guardian IDs/names to authorized heads, without widening membership access. Local synthetic verification enables workflow evidence while managed identity and real school review remain open gates.
**What was rejected:** Automatically verified links, editable historical grants, granting all child fields to billing-only guardians, cached rights as authority, phone/name-only matching, or silent history truncation.

## 2026-09-28, Dated whole-class teaching scope
**What was decided:** Headteachers grant class roster access to existing live teacher memberships with reviewed reasons and immutable date ranges/name snapshots. A teacher request requires one unrevoked assignment covering both today's Ghana date and the requested roster date; future/expired grants provide no current access. Revoke and regrant instead of rewriting assignment history. Roster reads lock grants and class rows, exclude superseded/out-of-date enrolments, and return only learner names/admission numbers and internal record IDs. Page/search staff history, class choices and rosters.
**Why:** Login role alone cannot authorize a class or expose learner birth/contact/finance records. Current and record-date checks prevent expired or scheduled grants from reopening access, while class locks serialize roster counts/items with enrolment changes. This establishes the scope for attendance and later reviewed learning workflows.
**What was rejected:** Unscoped teacher learner lists, caller-selected dates as sufficient authority, mutable historical assignments, silently capped class lists, treating class grants as employment records or timetable approval, and unrestricted personal learner profiles.

## 2026-09-28, dated attendance registers
**What was decided:** Attendance uses school-day declarations plus one register per school/class/date. Registers derive eligible dated enrolments, start as draft, move through submit and headteacher lock, and require a reasoned correction after submission or lock. Version checks and operation receipts make retries safe; correction rows retain old/new marks and reviewer identity.
**Why:** This keeps daily work scoped to a live dated teaching grant, prevents incomplete roster writes, and gives finance/reporting later a reconciled historical attendance source without treating edits as silent history changes.
**What was rejected:** Caller-selected learners, attendance access based only on staff role, direct correction without a reason, and presenting local/API tests as browser or school acceptance.

## 2026-09-28, Supabase PostgreSQL provider selected
**What was decided:** Use Supabase as the hosted PostgreSQL provider. Keep disposable local PostgreSQL as the test target, require the restricted `school_app` runtime role and verified TLS, and keep migration privileges separate. Do not apply hosted migrations until the project connection and schema plan are reviewed.
**Why:** Evans selected Supabase and has created an account; least-privilege credentials preserve the existing FORCE RLS boundary while allowing a staged connection.
**What was rejected:** Using the Supabase `postgres` account for API traffic, committing connection secrets, or treating account creation as an applied schema or verified live connection.

## 2026-09-28, Veloxa SmartSchool outreach identity and scheduled launch
**What was decided:** John Evans Okyere named the product Veloxa SmartSchool, a product of Veloxa Technology Ltd., supplied +233544954643/+233245540271, requested 500 private-school leads over three days and authorised email scheduling at 09:00 today. Eastern Region comes first, with nearby-region expansion explicitly approved. Connected sender is okyerevansjohn@gmail.com. The active thread schedule releases groups at 09:00 through 15:00 on 28–30 September 2026; targets are 167/167/166.
**Why:** Build a demo-meeting pipeline and explicit waiting-list interest while the platform develops. Preserve the distinction between the sample-data demo and planned AI/SHS workflows, and pace individual invitations with delivery checks.
**What was rejected:** Claiming proven AI performance gains, treating all licensed schools as private, padding with shared/invalid/uncorroborated addresses, guaranteeing spam avoidance, automatic waiting-list enrolment, or treating scheduling as delivery. WhatsApp sends and calls remain unexecuted.

## 2026-09-28, One-time Supabase migration workflow
**What was decided:** Keep the existing migration command restricted to the disposable local database. Add a separate Supabase migration runner that uses a temporary `DATABASE_MIGRATION_URL` for the Supabase administrator, previews by default, checks file checksums, serializes applies, and requires `--apply` to change hosted schema. Keep the API on `school_app`.
**Why:** The application schema needs administrator DDL privileges, while runtime credentials should remain least-privilege; a separate reviewed apply step makes the hosted side effect explicit and resumable.
**What was rejected:** Pointing the local-only runner at Supabase, running migrations with the API role, or applying hosted schema as part of connection verification.

## 2026-09-28, Initial Supabase schema applied
**What was decided:** Apply migrations 001–012 to the Supabase project once through the separate administrator runner, verify the migration ledger has no pending files, remove the temporary admin URL, and keep runtime traffic on `school_app`.
**Why:** The hosted project was ready for its initial schema; separating setup privileges from app traffic keeps the runtime role restricted.
**What was rejected:** Leaving the admin connection in the app environment or treating a successful migration run as deployment or school acceptance.

## 2026-09-28, Private Supabase identity access and attendance snapshots
**What was decided:** Migrations 013–014 force RLS on users/sessions with backend-only identity policies, remove Supabase API-role grants and future public-schema API defaults for application objects, and snapshot learner roster identity when attendance is submitted. Draft edits remain ordinary saves; submitted corrections keep reasoned history.
**Why:** Hosted role inspection showed that missing users/sessions policies blocked `school_app`, while default API grants were broader than required. Attendance history must survive later backdated enrolment changes and school-day closure.
**What was rejected:** Public identity policies, changing storage-schema defaults, applying these migrations to Supabase without explicit hosted-apply authorization, or deriving finalized attendance membership from current enrolments.

## 2026-09-28, Separate hosted worker identity
**What was decided:** The background worker uses `school_worker` locally and a separate TLS-verified `WORKER_DATABASE_URL` in Supabase; it must not reuse the API's `school_app` credential.
**Why:** The worker needs queue claim/update privileges that are intentionally absent from the application role.
**What was rejected:** Broadening `school_app` to process durable jobs or silently starting a production worker without its dedicated credential.

## 2026-09-28, Finalized attendance writes and legacy recovery
**What was decided:** Finalized register reads, locks and corrections use the same captured roster. Migration 015 recovers pre-snapshot membership from persisted marks, labels it `legacy_marks`, retains already captured names, distinguishes finalized empty rosters and makes snapshots/provenance immutable. The UI exposes legacy uncertainty and keeps school-day and correction reasons separate.
**Why:** A later backdated departure or admission must neither block a valid historical correction nor add invisible marks. Old schemas did not store submission-time names or definitive roster membership, so recovery must remain explicit and reviewable.
**What was rejected:** Revalidating finalized marks against current enrolments, silently emptying old registers, inventing original names, rewriting captured membership or reusing a school-day reason as correction approval.

## 2026-09-28, Reviewed existing-learner CSV onboarding
**What was decided:** Stage bounded CSV input and immutable row validation before a headteacher selects approved rows. Flag exact admission-number conflicts and possible name/birth-date matches; possible matches require explicit per-row review reasons and never merge identities. Revalidate before committing dated learners/enrolments, retain immutable approval/outcomes and bind retry receipts to the payload. School identity-catalog locks serialize imports with admission creation/enrolment; class locks retain dated capacity checks. Apply migration 016 only locally.
**Why:** Existing-school onboarding must preserve human identity decisions, school isolation, capacity, history and atomic audit evidence while allowing invalid rows to be excluded. Browser checks bind confirmation to the final selection and expose committed reasons after reload.
**What was rejected:** Auto-merging names, importing logins/invoices, partial commit on errors, silently stale approvals, and applying hosted schema without reviewed authorization.

## 2026-09-28, Authorized collection and one-time exceptional pickup
**What was decided:** Headteachers/front desk record current Ghana-day collection for effectively enrolled learners after live verified pickup rights and in-person identity confirmation. Unexpected collectors require a fixed request and headteacher review; approval lasts one day, can be cancelled before use and remains consumed after a recording correction. Preserve original learner/class/enrolment/collector snapshots and reasoned void evidence. Do not infer custody from attendance or require an attendance-open declaration. Teacher/guardian/accountant roles have no general collection access in this slice.
**Why:** Payment, name matching, stale links or a previous approval cannot establish safe pickup authority. Learner-to-class and authority-to-membership locks serialize release with withdrawal and revocation. Narrow definer functions support front desk without broadening membership access. Receipts store stable IDs and rebuild current-role projections, preventing cached head-only notes after demotion.
**What was rejected:** Automatic exceptional pickup, editable history, treating void as physical return, reusing consumed approvals, hidden history truncation, hiding departed learners from historical lookup and hosted migration/deployment without authorization.

## 2026-09-28, Early-years policy and observation boundary
**What was decided:** Nursery and KG use separate school-configured policies with source/version/effective dates; Nursery additionally requires school-supplied specialist-review evidence. Observations retain bounded factual evidence, indicator/descriptor and learner/class/enrolment/educator/policy snapshots, with no universal score or diagnosis. Corrections append immutable versions; assignment revocation and policy retirement preserve access boundaries and historical evidence. Migration 018, API, focused PostgreSQL/API tests and teacher/headteacher UI are drafted; API/UI builds and test typecheck pass, but database/API/browser behavior is unverified until migration approval and execution.
**Why:** The domain rules require narrative progress and specialist-reviewed Nursery expectations while distinguishing school-supplied provenance from externally verified curriculum claims.
**What was rejected:** Hardcoded national indicators, merging Nursery and KG, scoring inferred development, overwriting historical observations, or calling a successful build functional verification.

## 2026-09-29, Narrative reports use review-bound evidence
**What was decided:** Migrations 018–019 and the Nursery/KG report flow were applied and tested only against disposable local PostgreSQL. Reports snapshot observations and finalized attendance, require headteacher approval before publication, invalidate approval when evidence changes, retain prior revisions, and expose only published narratives to verified academic guardians. Guardian refresh revalidates the report panel; class choices can be refreshed after setup changes.
**Why:** A rendered build did not prove the workflow, and stale evidence or cached guardian links could reveal an unreviewed report or keep revoked child access visible.
**What was rejected:** Treating builds as functional acceptance, publishing changed evidence under stale approval, replacing past reports, or relying on stale guardian selectors after rights change.

## 2026-09-29, readiness via ledger function; per-run test databases
**What was decided:** `/readyz` reads the migration ledger through a SECURITY DEFINER function (migration 020) callable by `school_app`, because the hosted ledger table is revoked from the runtime role. Tests and browser runs execute in a fresh database cloned from a migrated template (`school_saas_template`), dropped afterwards. `migrate.ts` (local only) wraps `CREATE ROLE` so a second local database can be migrated.
**Why:** Keeps the runtime role least-privileged while giving deployments a real "schema behind code" signal; stops synthetic data from piling up and causing browser timeouts.
**What was rejected:** Granting `school_app` SELECT on the ledger, editing applied migration 002, truncating fixtures between suites. Hosted state: 013–019 were already applied; Evans applied 020 on 2026-09-29.

## 2026-09-29, platform administrator with full cross-school access
**What was decided:** Evans (platform admin) creates real school accounts from an admin panel. Interim sign-in is email + temporary password with forced change (`AUTH_MODE=password`); SMS OTP through Arkesel and Moolre (either, with fallback) and managed auth come later. The admin can open any school for support by explicit "enter", which creates a support membership and an audit event visible to that school's headteacher; other admin actions create the membership revoked only to satisfy audit foreign keys.
**Why:** Schools need accounts now; existing RLS/membership code keeps working unchanged because admin access is a real membership guarded by `platform_admins`.
**What was rejected:** A no-child-data admin (recommended, but Evans chose full super-user, which raises Act 843 exposure: document it in the school agreement and keep the audit trail), invite links, keeping login localhost-only. Removing a `platform_admins` row immediately disables all support access.

## 2026-09-29, AI drafting design
**What was decided:** AI drafts only, behind a provider seam (Anthropic adapter + deterministic template fallback), off by default at platform and school level, minimised/de-identified inputs, validated JSON outputs with citations, append-only run log without prompts or generated text, template fallback for every failure. First feature is Nursery/KG report remarks; further features are listed in docs/AI_DESIGN.md.
**Why:** Keeps human approval and school isolation intact, gives value without risking child data, and works when AI is unavailable.
**What was rejected:** Free-form chat over child data, storing prompts, automatic provider fallback, letting models compute grades or fees.

## 2026-09-29, Pilot sign-in is password-only; payments and stronger auth deferred
**What was decided:** Evans creates pilot school accounts in the admin dashboard and works with schools while they use the platform. Users sign in with the temporary password and must change it; no payment integration and no MFA/SMS OTP for the pilot (`MFA_REQUIRED=false`, `AUTH_MODE=password`). Notices are in-app first; SMS stays off until a provider is configured and tested (deliveries recorded as suppressed, sent at most once, never auto-retried).
**Why:** Evans will configure payment and authentication per school later, with schools present; blocking the pilot on those adds no value now.
**What was rejected:** Blocking the pilot on MFA/SMS OTP or mobile-money gateway. Risk accepted: the platform admin (cross-school access) is password-only under a global MFA switch, so that account needs a long unique password.

## 2026-09-29, Host on Vercel for the pilot; DigitalOcean later
**What was decided:** Deploy the pilot on Vercel (static web app + one API function + daily cron for the job queue). Evans will move to DigitalOcean as the platform grows; the existing Dockerfile (API and worker as separate commands) is the migration path.
**Why:** Fastest route to a live pilot with no server to manage; the daily cron limit (Hobby plan) only delays audit exports, and SMS is off.
**What was rejected:** Making the cron frequent or the audit export synchronous now — not worth it for the pilot.

## 2026-09-29, Hosted migrations 021–028 applied
**What was decided:** Evans asked the assistant to run the hosted migration; it was previewed, then applied with the reviewed runner and verified (ledger complete, runtime role connects). The earlier attempt was blocked until Evans explicitly requested it.
**Why:** The deployed code requires the schema (`/readyz` and startup checks refuse an older ledger).
**What was rejected:** Applying without a preview, or leaving the administrator URL in `.env` after the platform-admin step.

## 2026-09-29, Hosting: Render (API + worker) + Vercel (web app) — supersedes Vercel-only
**What was decided:** Backend on Render from the existing Docker image (web service plus background worker), frontend on Vercel with `/api/v1/*` proxied to Render. The Vercel function/cron packaging was removed. DigitalOcean remains the later move.
**Why:** Evans's preference; keeps the always-on worker (no cron limits) and the first-party cookie (`SameSite=Strict`) works because the browser only sees the Vercel domain.
**What was rejected:** Calling the Render URL directly from the browser (cross-site cookie would not be sent), Vercel serverless functions plus a daily cron.

## 2026-10-04, Google-style app shell with setup in Settings
**What was decided:** At Evans's request the web app uses a Google-platform look (Roboto, Material Symbols, blue #1a73e8 primary with red #d93025 accent, white icon sidebar, compact pill buttons, bounded input widths, minimal page text). All headteacher setup lives in Settings as ordered steps; daily pages carry only daily work, via a `view: 'setup' | 'work'` prop on modules that mix both.
**Why:** The tabbed single-column layout looked like a demo and mixed configuration with daily tasks; the target users are teachers reluctant to use software.
**What was rejected:** Duplicating setup forms in new components, keeping six combined tabs, a dark sidebar.

## 2026-10-04, Follow the client demo's layout and look (supersedes the Google-style look)
**What was decided:** Evans finds the client demo (`demos/school-mangement`) easier to use than the production app, so the production web app adopts the demo's patterns: a page header with title, one-line purpose and actions on the right; data first (stat cards, tables) with sensible defaults (first class, newest term); forms in dialogs and record details in a side drawer; crimson accent with Plus Jakarta Sans. This replaces the blue Google-style palette from earlier today; the Settings-for-setup split is kept. Plain CSS, no Tailwind or router added.
**Why:** The production pages stacked lists, forms and searches in one long card, opened on empty selects and showed records as text lines, so daily work was hard to find.
**What was rejected:** Copying the demo's Tailwind/react-router stack (large dependency and rewrite for no user benefit), keeping the blue Google look, rewriting every module at once (done in tested slices instead).

## 2026-10-04, Client demonstrations run on the production app with a local demo school
**What was decided:** Evans demonstrates the real production system to clients, using a realistic school loaded into a separate local database (`school_demo`, `npm run dev:demo` / `npm run demo:reset`). The demo is data, not a second UI: the production app is not being turned into the old client demo.
**Why:** The production system is the valuable product; prospective schools need to see it working with believable records rather than synthetic test rows.
**What was rejected:** Showing the old mock demo, seeding the development/test database (test runs would pollute it and it would pollute tests), inserting demo records directly in SQL (would bypass the rules, versions and audit trail that the API enforces).
