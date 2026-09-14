---
name: tixbit
description: Search TixBit events and listings, inspect seatmaps, create browser checkout links, or purchase a selected listing through MPP.
---

# TixBit Skill

Use the official CLI and prefer `--json` for agent-readable output:

```bash
npx tixbit <command>
```

Discovery, listings, seatmaps, event URLs, link-only checkout, and machine
purchase require no TixBit API key. Machine purchase requires an mppx account
and an email address supplied by the buyer. Never infer the email from git, OS,
or account state.

## Commands

```bash
npx tixbit search "Braves" --city Atlanta --state GA --size 10 --json
npx tixbit listings <eventId> --size 10 --sort asc --json
npx tixbit seatmap <eventId> --json
npx tixbit url <eventId>

# Link-only browser checkout; this does not charge the buyer.
npx tixbit checkout <listingId> --quantity 2 --json

# Machine checkout; obtain explicit authorization before any real payment.
npx tixbit purchase <listingId> \
  --quantity 2 \
  --email buyer@example.com \
  --confirm --max-price <approved-total-usd> \
  --idempotency-key <stable-uuid-v4> \
  --json
```

## Additional commands (requires this build or a later release)

- `tixbit quote <eventId> --size 100`: refresh existing listings; requires live freshness.
- `tixbit auth`: public browser sign-in and wallet setup links; not a CLI login. No command needs a developer API key.
- `tixbit buy <listingId> --quantity 2 --max-price <total-usd> --email <buyer-email>`: quote only, no payment credential required.
- Add `--confirm` only after approval. Without payment authorization, the result is `authorization_required` with a browser checkout URL, not a payment. Review the final total in the browser; the CLI cap is not transferred there. Optional advanced integrations can inject a user-approved `TIXBIT_LINK_TOKEN`; automatic payment still requires server cap support. Never put tokens in arguments.
- Link supports 4-12 alphanumeric IDs only, not native `sl_UUID` listings. Use browser checkout for unsupported listings.
- Without a signed-in user integration, seller commands return browser sign-in guidance and do not read or submit listings. Browser-to-CLI seller sessions are not supported. Do not extract browser tokens. Optional authorized integrations may supply `TIXBIT_ACCESS_TOKEN`; seller creation still requires `--confirm`, `termsAccepted: true`, and server ownership/access checks.
- All commands emit JSON, including errors. Preserve full case-sensitive IDs.
- Never retry uncertain Link payment automatically. Reconcile with support and Stripe Link first. Read seller listings after uncertain creation.
- No bids or negotiation are available. Do not claim a price reduction.

## Required workflow

1. Search and select the event.
2. Fetch listings and the seatmap before presenting ticket options.
3. Confirm the exact listing, quantity, and buyer email.
4. Use `checkout` for user-completed browser payment, or `purchase` only when the
   user explicitly authorizes machine payment.
5. Preserve the original idempotency key across retries and recovery checks.
6. Treat `pending` and `manual_review_required` as non-final. Follow the returned
   `action`; never create another payment or ticket purchase for the same order.

The purchase result includes the TixBit `orderReference`, status, optional
`receiptUrl`, server-authoritative order total, and recovery action. Do not log
or repeat MPP private keys, payment credentials, or raw provider IDs.
