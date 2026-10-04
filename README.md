# Ghana School Management SaaS

**Implementation authorized · 28 September 2026 · Local synthetic development.**

An AI native service for Ghanaian Nursery, KG, Primary and JHS schools, designed to accommodate SHS later.

## Review guide

| Document | Purpose |
| --- | --- |
| [Product](docs/PRODUCT.md) | Scope, educational value, build order and decisions to review |
| [Architecture](docs/ARCHITECTURE.md) | Proposed stack, tenancy, data, security, AI and operations |
| [Domain rules](docs/DOMAIN_RULES.md) | Rules and acceptance cases for each school workflow |
| [Research](docs/RESEARCH.md) | Ghana evidence, source limitations and demo findings |

For agents: [AGENTS.md](AGENTS.md) gives a short reading path. Agents should **not read every document each session**. [STATUS.md](STATUS.md) records actual progress; [MEMORY.md](MEMORY.md) records significant decisions. Your original instructions remain in [AGENT.md](AGENT.md).

The separate client demo remains untouched; its code and fixtures have not been imported. Original agent instructions remain preserved. Evans authorized P1–P4 implementation and disposable local migrations, followed by feature pushes to GitHub. Deployment, shared databases and real communications require separate authorization.

## Run it: local or cloud

| Command | Database | Sign in with |
| --- | --- | --- |
| `npm run dev:local` | Disposable local PostgreSQL, started, migrated and seeded automatically | Synthetic accounts below, password `Synthetic-only-2026!` |
| `npm run dev:cloud` | Supabase, from `DATABASE_URL` in `.env` (copy `.env.example`) | Real accounts created by the platform administrator |

Both start the API and web app together; open `http://127.0.0.1:5178` and press Ctrl+C to stop both. Cloud mode reads and writes the shared Supabase database, so apply migrations first (`npm run db:migrate:supabase`) and create the first administrator as described in [DEPLOYMENT.md](docs/DEPLOYMENT.md) (`DATABASE_TARGET=supabase npm run platform-admin -w backend -- "Full Name" you@example.com`). The deployed site always shows the cloud sign-in page; the synthetic hints appear only in local mode.

## Local development

Requires Node.js 22.22.3, npm and PostgreSQL binaries (`pg_config` on PATH). The tooling creates only `.local/postgres`, a disposable cluster with a private Unix socket and no TCP listener. It never accepts a shared database URL. Local trust authentication is confined to this synthetic cluster and is not a production setup.

```bash
npm ci --ignore-scripts
npm run db:start
npm run db:migrate
npm run seed -w backend
DEV_AUTH=synthetic-local npm run dev:api
# In another terminal:
npm run dev:web
# For durable export jobs, in a third terminal:
npm run dev:worker
```

Open `http://127.0.0.1:5178`. Synthetic accounts: `head@example.test`, `frontdesk@example.test`, `teacher@example.test`, `guardian@example.test`; password `Synthetic-only-2026!`. The seeded headteacher belongs to two synthetic schools; API tests add isolated synthetic school fixtures. Sessions use HttpOnly cookies and write CSRF tokens. Synthetic login is explicitly opt-in and loopback-only; managed OIDC/MFA is not implemented. Production database startup is blocked.

```bash
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm audit
```

Checks use the disposable database and synthetic fixtures. API tests deliberately expire/revoke fixture sessions; run them before browser checks. Browser tests exercise school setup, admission review/enrolment, transfer/withdrawal history and reload, superseded future transfers, exports, guardian verification/scoped views/revocation, teacher grant/scoped-roster/revocation, and denied teacher administration. They launch API/web servers if absent and may reuse this project's already-running local servers. See STATUS.md for verified features and remaining milestone gates. CI builds and tests; it does not deploy. Local screenshots/downloads stay under `.local/`; failing browser traces stay under ignored `test-results/`.
