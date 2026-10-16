# Seller workflows

These workflows apply after publication of a seller-capable 0.3.0 or newer
release and authorized production seller configuration/client allowlisting.
The current candidate is unpublished; its issued public client is not yet
production-approved, and account configuration is absent. Do not attempt seller
sign-in or mutations until those prerequisites are complete.


## Reprice owned tickets

```sh
tixbit sell list
tixbit sell status "$SELLER_LISTING_ID"
```

Use an owned seller ID. Agree on a new USD unit price; quantity stays unchanged.
Write `reprice.json`:

```json
{ "listingId": "REPLACE_WITH_OWNED_SELLER_ID", "priceCents": 11000 }
```

```sh
tixbit sell reprice --file reprice.json --dry-run
tixbit sell reprice --file reprice.json --attempt "$ATTEMPT_UUID"
tixbit sell review "$REVIEW_ID"
# Only after exact owner approval:
tixbit sell confirm "$REVIEW_ID" --confirm
tixbit sell status "$SELLER_LISTING_ID"
```

Each intent uses a fresh UUID v4. Changing the JSON after preparation does not
change the review. Abandon the old review and prepare again after renewed
approval. A stale listing snapshot, sold tickets or an in-progress sale can
prevent repricing. Refresh inventory instead of bypassing the rejection.

## Remove an unsold listing

Read its status and confirm the exact listing to remove. Write `delist.json`:

```json
{ "listingId": "REPLACE_WITH_OWNED_SELLER_ID" }
```

```sh
tixbit sell delist --file delist.json --dry-run
tixbit sell delist --file delist.json --attempt "$ATTEMPT_UUID"
tixbit sell review "$REVIEW_ID"
# Only after exact owner approval:
tixbit sell confirm "$REVIEW_ID" --confirm
tixbit sell status "$SELLER_LISTING_ID"
```

Delisting removes eligible unsold tickets from sale. It cannot cancel an event,
purchase, completed sale or transfer. Provider cleanup can still be pending;
report the actual returned status rather than promise immediate removal across
all marketplaces. To abandon a review instead, use `tixbit sell cancel REVIEW_ID`.

## General admission and disclosures

For GA use `generalAdmission: true`, the real GA section label and no invented
seat labels. Supported disclosure values: `ada`, `twenty_one_plus`,
`obstructed_view`, `limited_view`, `standing_room`, `aisle_seat`. Notes are limited
to 280 characters. If an actual restriction cannot be represented safely, use
the website/support instead of omitting it.

## Handoff

Report event/date/venue, seller listing ID, quantity, USD unit price, actual
status and next action. Include safe review/attempt IDs for recovery. Never
include nonces, tokens, callback URLs, cookies or private state contents.
