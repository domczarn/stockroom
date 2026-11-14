# Vinted receipt imports

Unattended imports authenticate with a short-lived HMAC token in the
x-stockroom-service-authorization header (Bearer <expiry>.<hmac>), signed with
the STOCKROOM_SERVICE_KEY Worker secret. Never store the key in source, logs or
shell arguments. The service paths (/api/purchases, /api/sale-imports,
/api/sync-status, /api/market-research) need a Cloudflare Access Bypass policy
so the importer can reach them without an interactive login.

The existing purchases endpoint is unchanged. POST /api/sale-imports accepts
a JSON object with an events array of up to 100 entries. Each entry contains
transactionId, receiptId, name, stage, date and amount. IDs and dates are strings.
Use an actual YYYY-MM-DD event date. Allowed stages are sold, posted, completed,
paid and refunded. A positive GBP amount is required for sold and refunded.
Use null for unknown amounts at other stages. Only use verified seller-facing
Vinted receipts. A buyer's delivery email or an aggregate withdrawal is not a
sale or payout receipt.

The API upserts one entry per transaction ID and stage and returns success and
count. GET /api/sale-imports returns events including the composite ID.
Reviewers must match an event to a specific stock item before any accounting
changes. A paid event requires a confirmed payout amount. The reviewed key
prevents reapplying a receipt when the sync replays it.
