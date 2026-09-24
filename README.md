# tixbit

Search events, view seatmaps, browse listings, get browser checkout links, and purchase through MPP on [TixBit](https://www.tixbit.com) — from the terminal, your code, or an AI agent.

No command requires a TixBit developer API key. Public discovery and links need no credentials. Purchases require user-approved payment; selling requires user sign-in and seller access.

### User authorization, not API keys

Run `tixbit auth` for public browser sign-in and wallet setup links. This command does not create a CLI session. Open the returned TixBit sign-in page, then complete checkout or selling in your browser. Do not copy browser cookies or bearer tokens.

The public service currently has no supported browser-to-CLI seller session exchange. Website sign-in therefore does not unlock seller API calls from this CLI. Checkout discovery also does not expose the merchant identity needed for automatic Link shared-payment-token authorization. The CLI does not guess it or invent a login endpoint.

For wallet setup, use [official Link onboarding](https://link.com/agents): install `@stripe/link-cli` and run `link-cli onboard`. This requires your Link account, not a developer API key. It does not by itself authorize this CLI to charge TixBit. Browser checkout is the normal path until automatic authorization is supported; MPP remains available with your wallet.

| Operation | Required user authorization |
|---|---|
| Search, browse, listings, quote, seatmap, URL, checkout link | None |
| `buy` quote | Buyer email via `--email` or optional `TIXBIT_EMAIL` |
| Browser purchase | Sign in and approve the final payment in the browser |
| MPP `purchase` | Your mppx wallet, buyer email, confirmation, total cap, recovery UUID |
| Automatic Link payment | User-approved payment credential from an authorized integration |
| Seller API | Signed-in user credential and seller access |

## Install

```sh
# Use instantly with npx (no install)
npx tixbit search "Hawks" --state GA

# Or install globally
npm install -g tixbit
tixbit search "Hawks" --state GA

# Or add to a project
npm install tixbit
```

## CLI

### Search events

```sh
tixbit search "Taylor Swift"
tixbit search "Hawks" --state GA --size 5
tixbit search --city "New York" --category nba-basketball
tixbit search --league NBA --parking exclude
```

### Browse local events

```sh
tixbit browse --city Atlanta --state GA
tixbit browse --lat 33.749 --lng -84.388 --category CONCERT
```

### Get ticket listings

```sh
tixbit listings <event-id>
tixbit listings <event-id> --size 5 --sort asc
```

### Buy tickets

```sh
# Get a checkout link for a listing
tixbit checkout <listing-id> --quantity 2

# Or pay from an agent/terminal with MPP
npx mppx account create
tixbit purchase <listing-id> \
  --quantity 2 \
  --email buyer@example.com \
  --confirm --max-price 300.00 \
  --idempotency-key 11111111-1111-4111-8111-111111111111 \
  --json
```

`checkout` remains link-only: it creates a `https://www.tixbit.com/checkout/process` URL for browser completion. `purchase` is the separate public MPP machine surface. It uses the official `mppx` client to answer the server's HTTP 402 challenge and currently selects the Tempo one-time charge rail configured by the server.

### Stripe Link machine checkout

Sign in to Link once, then start a purchase with a total price limit:

TixBit 0.2.0 needs Node.js 22 or later. The included Link CLI uses your local Link sign-in; TixBit does not ask for a developer API key.

```sh
npx @stripe/link-cli auth login
tixbit link start <listing-id> --quantity 1 --email buyer@example.com --max-price 25.00
```

`link start` returns the exact server total and an `approvalUrl`. Open that URL and approve the spend request in Link. Then use the returned order reference:

```sh
tixbit link complete <order-reference>
```

The second command checks approval, sends one Stripe MPP credential, and reports whether the ticket was issued. If approval is still pending, it returns the same URL without sending payment. If the payment result is uncertain, use `link complete` with the same order reference. The CLI stores the purchase key in a private file under `~/.local/state/tixbit/link` (or `XDG_STATE_HOME`) and never prints or saves the Link payment token. Keep that file until the order is settled. Each command returns JSON; `approval_required` and payment failures use exit code 2.

`--email` is always required and is never inferred from git or local account state. If a request times out or returns `pending` or `manual_review_required`, reuse the same idempotency key and follow the returned `action`; do not start another payment.

### Live inventory, Stripe Link, and seller commands

These additions require a build of this PR or a later authorized package release. The existing registry package is still named `tixbit`; this PR does not publish it.

```sh
# Refreshed listings, not a reservation. Fails if live freshness is unavailable.
tixbit quote <eventId> --page 1 --size 100

# Buyer email is explicit; no API key or payment credential is needed.
tixbit buy <listingId> --quantity 2 --max-price 300.00 --email buyer@example.com

# Without payment authorization, returns a browser checkout handoff.
# No payment is sent; review and approve the final total in the browser.
tixbit buy <listingId> --quantity 2 --max-price 300.00 --email buyer@example.com --confirm

# Without a signed-in integration, returns browser sign-in and seller links.
tixbit sell list
```

A handoff returns `success: false`, `status: "authorization_required"`, and exit code 2. It is not a completed purchase, listing, or CLI login. The CLI cap is not transferred to browser checkout; review and approve the final total there.

### Optional advanced integrations

Authorized applications may supply a user-approved Link payment credential or a signed-in seller's Privy access token. Optional `TIXBIT_LINK_TOKEN` and `TIXBIT_ACCESS_TOKEN` injection is for these integrations only, not normal onboarding. Neither is a TixBit API key, and no developer or infrastructure key can replace user authorization. Never pass credentials in arguments, log them, or extract them from browser storage. Seller integrations use `tixbit sell create --confirm < listing.json`.

`--max-price` is the total USD charge ceiling including ticket fees, not a per-ticket price or a bid. Link checkout sends `maxAmountCents` in both POST requests and refuses payment unless the quote advertises `maxAmountCentsSupported: true`. Payment requires a public checkout deployment that advertises and enforces the total cap. The backend rechecks its actual charge before payment. Link currently accepts only 4-12 alphanumeric listing IDs. Native `sl_UUID` listings are not supported by this payment backend; use link-only `checkout` for browser completion instead.

No Link payment request is automatically retried. An uncertain Link response returns `status: "unknown"` and requires reconciliation with TixBit support and Stripe Link before another attempt. A successful payment response is not a guarantee of completed ticket delivery. No negotiation API or command is provided.

Seller JSON uses the existing web API schema. Example after seller approval:

```json
{"externalEventId":"AbCd12","section":"GA","quantity":2,"generalAdmission":true,"priceCents":10000,"termsAccepted":true}
```

`priceCents` is the seller's per-ticket asking price, unlike the buyer's total cap. Optional fields include `row`, `seatNumbers`, `faceValueCents`, `assetPaths`, `disclosures`, and `notes`; the server validates them and enforces seller access. Creation requires both `--confirm` and `termsAccepted: true`. Submission is not a claim that the listing is live. After uncertain creation, inspect `sell list` before retrying.

MPP `purchase` retains the official mppx path but now requires `--confirm`, `--max-price`, and an explicit `--idempotency-key` before wallet loading. Its challenge hook checks the pathUSD atomic amount before any credential is created, rejects unknown assets/recurring intents, and permits only one payment challenge. The cap covers the ticket charge; network fees, if any, are managed separately by the wallet. SDK callers who inject their own `paymentFetch` own its authorization policy: use `assertMppChallenge` in `onChallenge` as shown below and get user approval before calling `purchaseTickets`. Do not register credential-producing event handlers that bypass this hook.

### View venue seatmap

```sh
tixbit seatmap <event-id>
tixbit seatmap <event-id> --section <section-name>
```

### JSON output (for agents / scripting)

Every command now emits JSON by default, including help, version, parser errors, and request errors. `--json` remains accepted. Successful discovery results keep their existing fields and add `success: true`. Exit codes: 0 for success, 1 for invalid input/request failure, 2 for a non-final or unsuccessful result.

> Event and listing IDs are case-sensitive. Copy the full ID from discovery. The SDK no longer changes case, strips prefixes, or repairs whitespace in purchase IDs.

```sh
tixbit search "concert" --state NY --json
tixbit listings <event-id> --json
tixbit seatmap <event-id> --json
tixbit checkout <listing-id> --quantity 2 --json
tixbit purchase <listing-id> --quantity 2 --email buyer@example.com --confirm --max-price 300.00 --idempotency-key <uuid-v4> --json
```

### All commands

| Command | Description |
|---|---|
| `auth` | Public browser sign-in and wallet setup; no CLI session is created |
| `search [query]` | Search events by keyword, city, state, category, or date |
| `browse` | Browse upcoming events near a location |
| `listings <eventId>` | Get available ticket listings for an event |
| `checkout <listingId>` | Get a checkout link to buy tickets |
| `purchase <listingId>` | Buy a selected listing through MPP with explicit confirmation and total cap |
| `link start <listingId>` / `link complete <orderReference>` | Approve and pay for a ticket with Stripe Link |
| `quote <eventId>` | Refresh live listings, with freshness metadata |
| `buy <listingId>` | Quote or confirm a capped Stripe Link purchase |
| `sell list` / `sell create` | Use the existing gated seller API |
| `seatmap <eventId>` | Show the venue seating chart with all sections |
| `url <slug>` | Print the TixBit event page URL |

## SDK

Use the client programmatically in a supported Node.js project:

```ts
import { TixBitClient } from "tixbit";

const tixbit = new TixBitClient();

// Search events
const { events } = await tixbit.searchEvents({
  query: "Hawks",
  state: "GA",
  size: 5,
});

const event = events[0];
if (!event) throw new Error("No matching events");

// Get public event detail
const detail = await tixbit.getEvent(event.external_event_id);

// Get listings
const { listings } = await tixbit.getListings({
  eventId: event.external_event_id,
});

const listing = listings[0];
if (!listing) throw new Error("No available listings");

// Get current public details for one listing
const listingDetail = await tixbit.getListing(listing.id);

// Create a checkout link
const checkout = tixbit.createCheckoutLink({
  listingId: listingDetail.listing.id,
  quantity: 2,
});
console.log(checkout.url);
// Open this TixBit URL in a browser to complete checkout.

// View seatmap
const seatmap = await tixbit.getSeatmap({
  eventId: event.external_event_id,
});
console.log(seatmap.venue_name);    // "State Farm Arena"
console.log(seatmap.section_names); // ["101", "102", ...]

// Browse nearby
const nearby = await tixbit.browse({
  city: "Atlanta",
  state: "GA",
});

// Event URL
const url = tixbit.eventUrl(event.external_event_id);
```

### SDK machine purchase

Wire the official `mppx` client into `paymentFetch`. The private payment key stays in the mppx account/keychain or `MPPX_PRIVATE_KEY`; it is never passed to TixBit SDK configuration.

```ts
import { TixBitClient, assertMppChallenge } from "tixbit";
import { Mppx, tempo } from "mppx/client";
import { resolveAccount } from "mppx/cli";

const account = await resolveAccount();
const payments = Mppx.create({
  methods: [tempo({ account })],
  polyfill: false,
  maxPaymentRetries: 1,
  onChallenge: async (challenge) => {
    assertMppChallenge(challenge, 30000); // approved TOTAL, in USD cents
    return undefined;
  },
});
const tixbit = new TixBitClient({
  paymentFetch: (input, init) => payments.fetch(input, init),
});

const result = await tixbit.purchaseTickets({
  listingId: "LISTING123",
  quantity: 2,
  email: "buyer@example.com",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
});

console.log(JSON.stringify(result, null, 2));
// fulfilled: { status, orderReference, receiptUrl, order, ... }
// recovery:  { status: "pending" | "manual_review_required", action, ... }
```

## API Reference

### `new TixBitClient(config?)`

| Option | Type | Default |
|---|---|---|
| `baseUrl` | `string` | `https://www.tixbit.com` |
| `timeoutMs` | `number` | `15000` |
| `paymentEndpoint` | `string` | `https://mcp.tixbit.com/api/purchase`; canonical endpoint or loopback QA only |
| `paymentFetch` | `typeof fetch` | Fetch used for MPP; supply the official `mppx.fetch` |

All public TixBit SDK operations require no TixBit API key. MPP payment credentials are handled by the configured payment client and are sent only in the standard payment authorization header.

### `searchEvents(params?)`

| Param | Type | Description |
|---|---|---|
| `query` | `string` | Free-text search |
| `city` | `string` | City name |
| `state` | `string` | 2-letter state code |
| `category` | `string` | Category slug (e.g. `nba-basketball`) |
| `league` | `string` | League abbreviation |
| `categoryEventType` | `string` | `SPORT`, `CONCERT`, `THEATER`, or `ALL` |
| `performerId` | `string` | Public performer ID |
| `venueId` | `string` | Public venue ID |
| `parkingFilter` | `string` | `exclude`, `only`, or `include` |
| `nearLat` / `nearLng` | `number` | Coordinates for manual location filtering |
| `locationMode` | `string` | `inferred`, `manual`, or `none` |
| `startDate` | `string` | ISO date — events on/after |
| `endDate` | `string` | ISO date — events on/before |
| `page` | `number` | Page number (default: 1) |
| `size` | `number` | Results per page, max 200 (default: 25) |

The result includes normalized events plus `page`, `size`, nullable `total`/`totalPages`, `hasNext`, `hasPrev`, and `totalExact` pagination metadata.

### `getEvent(eventId)`

Returns the sanitized public event detail for an external event ID or event slug.

### `browse(params?)`

| Param | Type | Description |
|---|---|---|
| `city` | `string` | Preferred city |
| `state` | `string` | Preferred state |
| `latitude` | `number` | Latitude |
| `longitude` | `number` | Longitude |
| `categoryEventType` | `string` | `SPORT`, `CONCERT`, `THEATER`, or `ALL` |
| `page` | `number` | Page number (default: 1) |
| `size` | `number` | Number of results (default: 18) |
| `query` | `string` | Optional free-text query |
| `category` | `string` | Category slug |
| `league` | `string` | League abbreviation |
| `context` | `string` | `homepage`, `events`, or `category` |
| `recommendation` | `string` | `upcoming` or `trending` |
| `parkingFilter` | `string` | `exclude`, `only`, or `include` |

The result preserves the public browse endpoint's `total`, `totalExact`, `hasMore`, `page`, `pageSize`, and optional `degraded` metadata.

### `getListings(params)`

| Param | Type | Description |
|---|---|---|
| `eventId` | `string` | External event ID |
| `size` | `number` | Page size, max 100 (default: 50) |
| `page` | `number` | Page number (default: 1) |
| `orderByDirection` | `string` | `asc` or `desc` by price |
| `includeAll` | `boolean` | Request all available listings |
| `refresh` | `boolean` | Bypass cached listings for this request |

The result includes cache state, freshness, expiry, and pagination metadata when returned by the public endpoint.

### `getListing(listingId)`

Returns one sanitized public listing and any public disclosures for it.

### `createCheckoutLink(params)`

Create a checkout URL for a listing. The user opens this in a browser to review and complete the purchase on TixBit. This link-only method is unchanged by machine checkout.

| Param | Type | Description |
|---|---|---|
| `listingId` | `string` | Listing ID to purchase |
| `quantity` | `number` | Number of tickets (1–8) |

Returns `{ url, listingId, quantity }`.

### `purchaseTickets(params)`

Purchase a selected listing and quantity through the public MPP endpoint. TixBit prepares inventory and determines the listing price, currency, fees, and final amount on the server before issuing the challenge.

| Param | Type | Description |
|---|---|---|
| `listingId` | `string` | Listing ID selected from current listings |
| `quantity` | `number` | Number of tickets (1–8) |
| `email` | `string` | Required buyer email; normalized and validated before the request |
| `name` | `string` | Optional buyer/recipient name |
| `idempotencyKey` | `string` | Unguessable UUID v4 retry/recovery identity; generated when omitted |

Returns agent-readable JSON with `status`, `idempotencyKey`, `orderReference`, `receiptUrl` when available, optional server-authoritative `order`, and an `action` for non-final states. Network ambiguity resolves to `pending` instead of claiming failure.

### Agent SDK methods

- `quoteListings(params: GetListingsParams)` requests refreshed listings and requires live freshness. It preserves the existing listings result shape.
- `buyTickets({ listingId, quantity, email, maxAmountCents, confirm?, sharedPaymentToken? })` quotes by default. `confirm: true` requires a Link token and server cap support. It never retries a payment; ambiguous outcomes return `success: false`, `status: "unknown"`, and a recovery action.
- `getAuthorizationInfo()` returns public browser sign-in and wallet setup links without creating a CLI session.
- `listSellerListings(accessToken?)` reads the gated seller API, or returns browser sign-in guidance when no user credential is supplied.
- `createSellerListing(body, accessToken, confirm)` requires `confirm === true` and explicit `termsAccepted: true`. The web API remains the seller schema and access authority.
- `assertMppChallenge(challenge, maxAmountCents)` rejects unsupported or over-cap MPP challenges. Use it before credential creation in an official mppx `onChallenge` hook, not after `paymentFetch` returns.

### `getSeatmap(params)`

| Param | Type | Description |
|---|---|---|
| `eventId` | `string` | External event ID |

Returns venue info, section list, zone groupings, first-party asset URLs (`background_image`, `coordinates_url`), and per-section `shape_path` data for overlay rendering.

### `eventUrl(slugOrId)`

Returns the full URL to the event page on `www.tixbit.com`.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `TIXBIT_BASE_URL` | Discovery URL; credential requests accept only the canonical origin or loopback QA | `https://www.tixbit.com` |
| `TIXBIT_EMAIL` | Optional alternative to `buy --email` | none |
| `TIXBIT_LINK_TOKEN` | Optional advanced integration: user-approved Link credential; never an argument | none |
| `TIXBIT_ACCESS_TOKEN` | Optional advanced integration: signed-in seller user credential, not an API key | none |
| `TIXBIT_PAYMENT_URL` | Canonical MPP endpoint or loopback QA URL; no credentials, query, fragment, or redirects | `https://mcp.tixbit.com/api/purchase` |
| `MPPX_PRIVATE_KEY` | Optional mppx account source; prefer the OS keychain | mppx keychain |

## Requirements

- Runtime/tooling range: Node.js `^20.19.0 || >=22.12.0`
- CI compatibility matrix: Node.js 20.19, 22, 24, and 26

Node.js 20 is end-of-life and remains in CI only as a compatibility floor. Node.js 22 and 24 are LTS releases; Node.js 26 is the current release line.

## License

[MIT](LICENSE)
