
## Email connections (all free)

Sales, labels and QR codes reach Stockroom three ways. Each switches on when its settings exist.

### Outlook / Hotmail (one tap)
1. portal.azure.com → Microsoft Entra ID → App registrations → New registration.
   - Name: Stockroom. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: Web → `https://stockroom.bookednpaid.com/api/outlook/callback` → Register.
2. API permissions → Add a permission → Microsoft Graph → Delegated → `Mail.Read`, `User.Read`, `offline_access`, `openid`, `email` → Add.
3. Certificates & secrets → New client secret → copy the **Value**.
4. Cloudflare → Workers → stockroom → Settings → Variables and Secrets:
   - `MS_CLIENT_ID` = the Application (client) ID from the app's Overview page
   - `MS_CLIENT_SECRET` (secret) = the value from step 3. It expires (24 months max): set a reminder to renew it.
5. Optional, removes the "unverified" label: App registration → Branding & properties → Publisher verification (free, needs a Microsoft AI Cloud Partner Program ID for Booked & Paid Ltd).

### Forwarding (any email provider)
1. Cloudflare → bookednpaid.com → Email → Email Routing → Settings → add the subdomain `in.bookednpaid.com` → add the DNS records it shows. (Not the main domain: that would take over your normal email.)
2. Email Routing → Routing rules → Catch-all → Action: **Send to a Worker** → `stockroom`.
3. Workers → stockroom → Settings → Variables → `FORWARD_DOMAIN` = `in.bookednpaid.com`.

### Gmail (one tap, beta)
Limited to 90 accounts until Google verification, which needs a paid yearly security check. Not planned.

## Sending email from a subdomain

Stockroom mail (login codes, weekly report, Pip nudges) should come from `stockroom.bookednpaid.com`, not the main domain, so its reputation stays separate from your own inbox.
1. resend.com → Domains → Add domain → `stockroom.bookednpaid.com` → Region: Ireland (eu-west-1) → Add.
2. Click **Auto configure** (signs in to Cloudflare and adds the DNS records), or add the MX/TXT records it lists by hand in Cloudflare → bookednpaid.com → DNS.
3. Wait for Resend to show **Verified** (usually a few minutes).
4. Cloudflare → Workers → stockroom → Settings → Variables → `AUTH_EMAIL_FROM` = `pip@stockroom.bookednpaid.com` → Deploy.
