# ms-fb-integration — FreshBooks → UpFlow middleware

## What this is
NestJS service that syncs FreshBooks **clients + invoices** into UpFlow (AR platform).
Pull from FreshBooks (OAuth2 read), map, push to UpFlow (API key write). Prisma + Postgres (local via docker-compose; managed in staging).

## Rules (follow on every edit)
- Keep modules isolated: `freshbooks/` / `upflow/` / `sync/` each own their concern; cross-talk only via services.
- Mappers in `src/sync/mappers.ts` are PURE and unit-tested. No I/O there.
- All money: FreshBooks decimal strings → UpFlow integer cents via `moneyToCents` (`Math.round(parseFloat(x)*100)`). Never float-add money.
- Idempotency: every UpFlow write keyed by `externalId` (`fb_client_<id>`, `fb_invoice_<id>`). Customer upserted BEFORE its invoice.
- Retry 5xx/429 with backoff (`src/common/retry.ts`); never retry 4xx — log to `*Sync.error` and move on. Cap UpFlow concurrency at `SYNC_CONCURRENCY` (≤10; UpFlow limit is 600/min).
- FreshBooks tokens expire ~12h — always go through `FreshbooksOauthService.getValidAccessToken()` (auto-refresh), never a raw stored token.
- Never commit secrets. `.env` is gitignored; update `.env.example` when adding a var.
- TDD for mappers and any non-trivial logic.
- **MANDATORY after EVERY change:** run `npm run check` (= `npm test && npm run lint && npm run typecheck`). All must pass before claiming work done. Fix failures, never skip.

## Architecture
```
freshbooks/  OAuth + read API (clients, invoices, pagination)
   └─ freshbooks-oauth.service.ts   auth URL, code exchange, refresh, /me → accountId
   └─ freshbooks-api.service.ts     listClients / listInvoices / getInvoice
   └─ freshbooks-auth.controller.ts GET /auth/freshbooks[/callback]
sync/        mappers (pure) + orchestration
   └─ mappers.ts        FbClient→UpflowCustomer, FbInvoice→UpflowInvoice
   └─ sync.service.ts   backfill() / incremental() / syncInvoiceById()
   └─ sync.cron.ts      incremental poll (dormant unless SYNC_CRON_ENABLED)
   └─ sync.controller.ts  POST /sync, POST /sync/backfill, POST /webhooks/freshbooks
upflow/      write API (upsertCustomer / upsertInvoice, externalId-keyed)
prisma/      OAuthToken + CustomerSync + InvoiceSync + SyncCursor
common/      retry.ts (5xx/429 backoff)
commands/    backfill.ts (npm run backfill)
```
Data flow: FreshBooks (read) → mappers → UpFlow (write); state in SQLite.

## Commands
- `docker compose up -d`  — start local Postgres (localhost:5432); `down` to stop
- `npm run start:dev`     — run app (http://localhost:3000)
- `npm run backfill`      — full one-time import (clients then invoices)
- `npm run webhooks:register` — register FB webhook callbacks (needs PUBLIC_BASE_URL + running app/tunnel)
- `npm run webhooks:list`     — list registered callbacks
- `npm run webhooks:clear`    — delete all callbacks
- `npm test`             — unit tests
- `npm run lint`         — eslint (run after every change)
- `npm run typecheck`    — `tsc --noEmit` (run after every change)
- `npm run check`        — test + lint + typecheck (run after every change)
- `npx prisma migrate dev` — apply schema changes
- `npx prisma studio`    — inspect local DB

## After every change (REQUIRED)
Run `npm run check`. All three must pass.

## Setup
1. Register a FreshBooks app at https://my.freshbooks.com/#/developer → redirect URI `http://localhost:3000/auth/freshbooks/callback`, scopes `user:profile:read user:invoices:read user:clients:read`. Put client_id/secret in `.env`.
2. Get UpFlow sandbox API key+secret from the UpFlow app Settings → `.env`.
3. `cp .env.example .env` and fill it in. `npm install && npx prisma migrate dev`.
4. `npm run start:dev`, then visit `http://localhost:3000/auth/freshbooks` once to authorize.
5. `npm run backfill`.

## Endpoints
- `GET  /auth/freshbooks` / `GET /auth/freshbooks/callback` — one-time OAuth
- `POST /sync` — manual incremental sync
- `POST /sync/backfill` — manual full backfill
- `POST /sync/test?email=&dryRun=` — single-client test (dryRun default true)
- `POST /webhooks/freshbooks` — webhook receiver (handshake + HMAC verify + async dispatch)

## Webhooks (real-time sync)
- Needs a public HTTPS URL → FreshBooks can't reach `localhost`. Locally: ngrok (`ngrok http 3000`) → set `PUBLIC_BASE_URL` to the ngrok URL.
- Events handled: `invoice.create|update|delete`, `client.create|update|delete`. Delete mirrors a delete in UpFlow.
- Every event is HMAC-verified (`X-FreshBooks-Hmac-SHA256`, key = stored `verifier`). `WEBHOOK_VERIFY_SIGNATURE=false` only to capture a real payload in dev.
- Payload carries only the id → we fetch the object, upsert customer-before-invoice, then push.
- Flow: register (`webhooks:register`) → FB posts handshake → handler confirms verifier → events flow.

## Open items
- `netAmount` derivation: currently `gross − sum(line tax%)`, falls back to gross. Refine once we see real FB invoice tax fields in sandbox.
- Webhook signature/verification handshake — wire up before enabling the receiver.
- Webhooks need a public URL; locally use a tunnel (ngrok/cloudflared) or just use cron poll / backfill.

## Security
- Sandbox UpFlow + a live FreshBooks account. Rotate any credential ever pasted into chat/logs.
- Secrets only in `.env`. Tokens stored in Postgres (local docker / managed staging), never committed.
