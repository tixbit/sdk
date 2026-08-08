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
  --idempotency-key <stable-uuid-v4> \
  --json
```

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
