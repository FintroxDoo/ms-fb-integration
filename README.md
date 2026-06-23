# ms-fb-integration

Middleware that syncs **FreshBooks** clients + invoices into **UpFlow** (accounts-receivable).

NestJS · npm · Prisma + SQLite. Local-only.

## How it works
FreshBooks (OAuth2, read) → pure mappers → UpFlow (API key, write). State (tokens, sync log, cursor) in a local SQLite DB. Writes are idempotent (upsert by `externalId`), so re-running is safe.

## Quick start
```bash
npm install
cp .env.example .env        # then fill in FreshBooks + UpFlow credentials
docker compose up -d        # start local Postgres (localhost:5432)
npx prisma migrate dev      # create tables in the Postgres DB
# generate the local HTTPS cert (see "Local HTTPS" below)
npm run start:dev
```

> **Database:** local dev uses Postgres via `docker-compose.yml`. Start it with
> `docker compose up -d`, stop with `docker compose down` (add `-v` to wipe data).
> Staging points `DATABASE_URL` at the managed Postgres (`?sslmode=require`).
1. Register a FreshBooks app at https://my.freshbooks.com/#/developer
   - Redirect URI (must be HTTPS): `https://localhost:3000/auth/freshbooks/callback`
   - Scopes: `user:profile:read user:invoices:read user:clients:read`
   - Put `client_id` / `client_secret` in `.env`.
2. Get UpFlow **sandbox** API key + secret (UpFlow app → Settings) → `.env`.
   - `UPFLOW_API_BASE` must end in `/v1`.
3. Open `https://localhost:3000/auth/freshbooks` once to authorize FreshBooks
   (accept the self-signed cert warning on first load).
4. Run the initial import:
   ```bash
   npm run backfill
   ```

## Local HTTPS
FreshBooks requires an HTTPS redirect URI — even for local testing. Generate a
self-signed cert into `./certs` (gitignored), then run the app over HTTPS:
```bash
mkdir -p certs && openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```
`.env` controls this: `HTTPS_ENABLED=true`, `HTTPS_KEY_FILE`, `HTTPS_CERT_FILE`.
The browser shows a one-time "not secure" warning (self-signed) — click through.
Alternative: set `HTTPS_ENABLED=false` and front the app with a tunnel
(ngrok/cloudflared) whose public HTTPS URL becomes the redirect URI (also needed
later for FreshBooks webhooks).

## Sync modes
| Mode | Trigger |
|---|---|
| Full backfill | `npm run backfill` or `POST /sync/backfill` |
| Single client (test) | `POST /sync/test?email=<email>` (dry-run), add `&dryRun=false` to push |
| Incremental | `POST /sync` (manual), or enable cron via `SYNC_CRON_ENABLED=true` |
| Webhook (real-time) | FreshBooks → `POST /webhooks/freshbooks` — needs a public URL |

## Real-time webhooks
FreshBooks pushes invoice/client create/update/delete events to us in real time.
FreshBooks can't reach `localhost`, so expose the app with a tunnel.

1. **Tunnel** — sign up at ngrok, `ngrok config add-authtoken <token>`, claim a free
   static domain, then run it pointing at the app:
   ```bash
   ngrok http 3000          # use your static domain: ngrok http --domain=<name>.ngrok-free.app 3000
   ```
2. **Env** — set in `.env`:
   ```
   PUBLIC_BASE_URL=https://<your-domain>.ngrok-free.app
   HTTPS_ENABLED=false        # ngrok terminates TLS; OAuth is already done
   WEBHOOK_VERIFY_SIGNATURE=true
   ```
3. **Run + register** — start the app, then:
   ```bash
   npm run start:dev
   npm run webhooks:register   # registers callbacks; FreshBooks posts a handshake the app auto-confirms
   npm run webhooks:list       # all should show verified=true
   ```
4. **Test** — create/edit/delete an invoice or client in FreshBooks → it propagates
   to UpFlow within seconds. Inspect `InvoiceSync` / `CustomerSync` in `npx prisma studio`.

Events handled: `invoice.create|update|delete`, `client.create|update|delete`
(delete mirrors a delete in UpFlow). Each event is HMAC-verified.

## Scripts
- `npm run start:dev` — run with watch
- `npm run backfill` — full import
- `npm run webhooks:register|list|clear` — manage FreshBooks webhook callbacks
- `npm run check` — test + lint + typecheck (run after every change)
- `npx prisma studio` — inspect the local DB

## Mapping
- **Client → Customer:** `externalId=fb_client_<userid>`, name = organization or full name, address from `p_*` fields, main contact from email.
- **Invoice → Invoice:** `externalId=fb_invoice_<invoiceid>`, `customId=invoice_number`, amounts in **integer cents**, `customer={externalId: fb_client_<customerid>}`.

## Notes
- Money is converted from FreshBooks decimal strings to UpFlow integer cents.
- Customers are always upserted before their invoices (UpFlow requires the customer to exist).
- Secrets live only in `.env` (gitignored). Rotate any credential shared insecurely.

See [CLAUDE.md](CLAUDE.md) for architecture + contribution rules.
