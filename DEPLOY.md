# Deploying Stockroom on Cloudflare

Run from this folder. Needs Node 22+ and a Cloudflare account.

1. `npm install && npm test`
2. `npx wrangler login`
3. (done) D1 database "stockroom" created and migrated, id is already in wrangler.toml
4. `npx wrangler r2 bucket create stockroom-photos`
5. (done) migrations already applied; `npm run db:migrate` is safe to re-run for future ones
6. Secrets: `npx wrangler secret put STOCKROOM_SERVICE_KEY`, `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`
7. Zero Trust > Access > Applications: add a Self-hosted app for the Worker hostname. Allow the emails or login method you want
   (the first sign-in of an allowed email creates a member). Copy the Application Audience tag into ACCESS_AUD
   and your team domain (xxx.cloudflareaccess.com) into ACCESS_TEAM_DOMAIN in wrangler.toml.
8. Add a Bypass policy for /api/purchases, /api/sale-imports, /api/sync-status, /api/market-research
   (these are protected by the signed service key instead).
9. `npm run deploy`
10. Attach stockroom.bookednpaid.com (uncomment routes in wrangler.toml). Gmail OAuth only works on that origin,
    and the Google OAuth client needs https://stockroom.bookednpaid.com/api/gmail/callback as a redirect URI.

Without ACCESS_TEAM_DOMAIN and ACCESS_AUD set, every request is treated as signed out (fails closed).
