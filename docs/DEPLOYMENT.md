# Deployment and pilot runbook

Status: prepared and tested locally only. Nothing has been deployed; hosted migrations 021–028 are not applied. Every step below that touches hosted systems needs Evans's explicit approval at the time.

## 1. What is deployed

One container image (`Dockerfile`) run twice:

| Process | Command | Notes |
| --- | --- | --- |
| API + web app | `node backend/dist/main.js` | Serves `/api/v1`, the built web app (`WEB_DIST`), `/healthz`, `/readyz`. Run **one** instance until the login limiter moves out of memory. |
| Worker | `node backend/dist/jobs/worker.js` | Durable jobs (audit export). Needs `WORKER_DATABASE_URL`. |

The API refuses to start in production if the database ledger is behind `backend/migrations` (`assertMigrated`); `/readyz` reports the same state.

## 2. Environment (production)

| Variable | Purpose |
| --- | --- |
| `NODE_ENV=production`, `DATABASE_TARGET=supabase` | Enables secure cookies, hosted-database rules |
| `DATABASE_URL` | Supabase session-pooler URL for the restricted `school_app` role, `sslmode=verify-full`, `sslrootcert` path |
| `WORKER_DATABASE_URL` | Same for `school_worker` |
| `ALLOWED_HOSTS`, `ALLOWED_ORIGINS` | Public host name(s) and `https://` origin(s) |
| `TRUST_PROXY` | Number of proxy hops in front of the API (usually `1`) |
| `AUTH_MODE=password` | Interim email + temporary-password sign-in (until managed auth / SMS OTP) |
| `PORT`, `HOST`, `WEB_DIST` | Set by the image (`3018`, `0.0.0.0`, `/app/frontend/dist`) |
| `MFA_ENCRYPTION_KEY` | Long random secret used to encrypt authenticator secrets (required in production; back it up — losing it forces MFA re-enrolment). `MFA_REQUIRED` defaults to on in production |
| `MFA_REQUIRED=false` | Pilot decision (Evans, 2026-09-29): schools sign in with the temporary password they must change at first login; authenticator MFA and SMS OTP are configured later with each school. Note this also makes the platform administrator password-only, so use a long unique password for that account |
| `SMS_SEND_ENABLED` | Leave **unset** for the pilot start: notices are approved and shown in the guardian app, and SMS deliveries are recorded as "SMS switched off". To enable later set `SMS_SEND_ENABLED=true`, `SMS_PROVIDERS=arkesel,moolre`, `SMS_SENDER_ID`, `ARKESEL_API_KEY`/`MOOLRE_API_KEY`, and test each adapter with a sandbox number first (they have not been run against a live provider) |
| `AI_ENABLED` | Leave **unset** for the pilot start (AI off). To enable (Evans chose Claude, 2026-10-14): `AI_ENABLED=true`, `ANTHROPIC_API_KEY`, optionally `AI_MODEL` (default `claude-haiku-5-5`); run `npm run ai:eval -w backend` with the key first, and each school still switches AI on in Settings with its acknowledgement |
| `ASSISTANT_MODEL`, `ASSISTANT_EFFORT`, `ASSISTANT_PER_MINUTE` | The Ask assistant (headteachers, teachers) uses the same `AI_ENABLED`, `ANTHROPIC_API_KEY`, school switch and monthly cap. Optional: model (default `claude-opus-5-5`, about $0.02–0.09 per question; `claude-sonnet-5-5` is cheaper), effort (`medium`), questions per person per minute (`8`). Without a key the page says no AI provider is configured |

| `READ_ONLY_SCHOOL_IDS` | Comma-separated school ids that are read-only demo schools. Everyone signed in to such a school can read every page and use Ask (and the AI drafts), but every other change is refused with "read-only demo school", and its members cannot change their password. The app shows a banner. Unset (the default) changes nothing. To refresh the demo with `demo-hosted.ts`, remove the id, redeploy, run the loader, then add it back |

Never put the `postgres` administrator URL on the API host. It is only used from Evans's machine for `db:migrate:supabase` and `platform-admin`.

## 3. First-time setup (each step needs approval)

1. Choose the host: any container platform with HTTPS, a health check on `/healthz`, and a region close to Supabase `eu-central-1`. Put the site behind HTTPS only (HSTS is sent by the API).
2. Review then apply migrations 021–028 with the runner (preview first): `npm run db:migrate:supabase`, then `-- --apply`. Verify `npm run db:check:supabase`.
3. Create the platform administrator: `DATABASE_TARGET=supabase npm run platform-admin -w backend -- "Evans" you@example.com` (prints a one-time password; change it at first sign-in).
4. Deploy API and worker with the variables above; confirm `/readyz` is 200 and the login page loads over HTTPS.
5. Sign in as the platform admin, create the pilot school and its headteacher (share the temporary password privately). The headteacher creates staff and guardian accounts.
6. Rotate the `postgres` password after step 3 and keep it out of `.env`.

## 3b. Render (API + worker) and Vercel (web app) — chosen 2026-09-29

How the pieces fit: the browser only ever talks to the Vercel domain. `vercel.json` serves the static web app and **proxies `/api/v1/*` to the Render API**, so the session cookie (`SameSite=Strict`) stays first-party. Do not call the Render URL directly from the browser.

1. **Hosted migrations** (done 2026-09-29: ledger at 028). For later releases run the preview then `--apply` from your machine (section 3, step 2).
2. **Render**: New → Blueprint → this repo (`render.yaml`). It creates `school-api` (web, Docker, health check `/healthz`) and `school-worker` (background worker, same image). Fill the prompted secrets:
   - `DATABASE_URL`: `school_app` session-pooler URL with `?sslmode=verify-full&sslrootcert=bundled` (the Supabase CA ships in the image).
   - `WORKER_DATABASE_URL`: the `school_worker` URL with the same options.
   - `ALLOWED_ORIGINS`: `https://<your-vercel-domain>` (add your custom domain too, comma separated).
   - `ALLOWED_HOSTS` is pre-set to `school-api.onrender.com`; change it if Render gave the service a different hostname.
   - `MFA_REQUIRED=false` (pilot decision), `MFA_ENCRYPTION_KEY` (generated once by Render; keep it), `TRUST_PROXY=2` (Render's proxy plus Vercel's), `AUTH_MODE=password`.
   Check `https://<render-host>/readyz` returns 200.
3. **Vercel**: import the same repo (Root Directory = repo root, framework "Other"; `vercel.json` sets everything). Edit the destination in `vercel.json` if your Render hostname differs from `school-api.onrender.com`, then redeploy. No environment variables are needed on Vercel.
4. Open the Vercel URL, sign in. If any request fails with "Host not allowed" or "Request origin was not accepted", the API is telling you which allow-list entry is missing (`ALLOWED_HOSTS` / `ALLOWED_ORIGINS`).
5. Create the platform administrator once: `DATABASE_TARGET=supabase npm run platform-admin -w backend -- "Evans" you@example.com` (needs the admin URL from your machine; then remove it from `.env` and rotate the `postgres` password), sign in, create the pilot school and headteacher.

Notes:
- Use Render's paid (Starter) web service for the pilot: the free plan sleeps after 15 idle minutes and the first request then takes about a minute. The worker is only needed for audit exports and, later, SMS; you can leave it out at first.
- The login rate limiter is in memory per API instance (fine with one instance): use long unique passwords, especially for the platform admin account.
- The API also serves the web app itself at the Render URL; Vercel is the address you give schools.

## 3c. Shareable demo school (2026-10-14)

"Sunrise International School (Demo)" is a full synthetic Ghanaian school year in the production database, built through the live API by `backend/scripts/demo-hosted.ts` (state and passwords in `.local/demo-hosted/`, never committed). Run it from `backend/` with `DEMO_API=https://<api host>/api/v1 DEMO_CONFIRM_HOSTED=write-to-production npx tsx scripts/demo-hosted.ts <phase>`; phases `setup roll t1 t2 t3 promote current finish verify ask`, or `year` for the whole build. It resumes after any failure, and `current` run on a later day adds the new school days. The three shared logins (headteacher, Basic 6 teacher, parent) are written to `.local/demo-hosted/logins.txt`. After loading, put the school's id in `READ_ONLY_SCHOOL_IDS` so visitors cannot change it.

## 4. Data protection gate (before any real learner record)

- Register with, or confirm exemption from, the Data Protection Commission (Act 843).
- Sign the Supabase DPA; record the region; document retention, deletion and breach-response procedures.
- Sign a controller/processor agreement with the pilot school that states plainly that the platform administrator can open the school's data for support (each entry is audited and visible to the headteacher), that SMS and AI features are off, and who to contact for corrections.
- Guardian consent/notice text approved by the school.

## 5. Backups and restore drill

- Enable Supabase point-in-time recovery, or schedule `pg_dump` to separate storage; target RPO ≤ 1 h, RTO ≤ 4 h.
- Before go-live, restore into a scratch project with external sends disabled, run `db:check:supabase` and `/readyz` against it, and record the time taken.

## 6. Monitoring

- Uptime check on `/readyz`; alert on 503.
- Structured JSON request logs (request ID, route, status, duration, school ID; no child data) — ship them to the host's log service; alert on 5xx rate.
- Weekly: `platform.*` audit events per school, worker queue age (a metric is still to be built), disk and connection usage in Supabase.

## 7. Known limits for the pilot

- Pilot sign-in is email + temporary password with forced change for every role (`MFA_REQUIRED=false`). TOTP MFA is built and can be switched on per deployment; SMS OTP (Arkesel/Moolre) is not built. Payments (mobile money) are not integrated: fees are recorded by the accountant only.
- Notices: headteacher-approved, in-app for every recipient; SMS is off until a provider is configured and tested.
- One API instance (in-memory login rate limiter); no automatic scaling.
- Terminal reports can be corrected only through a reasoned reopening and a new revision; payment reversals exist, fee waivers do not.
- The Anthropic adapter is untested against the live API; AI stays off.
- No offline mode: schools use the printable register during outages.

## 8. Pilot go-live checklist

- [ ] Data protection gate (section 4) complete
- [ ] Migrations 021–028 applied and verified; `postgres` password rotated
- [ ] Staging or first deployment passes: sign-in, create school, year/classes, learners, attendance, assessment, fees, promotion (use the synthetic demo school first)
- [ ] Backups enabled and a restore drill recorded
- [ ] Headteacher trained (accounts, registers, follow-up, scores, fees); one week of dual running with paper registers
- [ ] Support contact and incident procedure agreed with the school
- [ ] Rollback plan: keep the previous image tag; migrations here are additive, so rolling the image back is safe
