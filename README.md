# tixbit

Search events, view seatmaps, browse listings, get browser checkout links, and purchase through MPP on [TixBit](https://www.tixbit.com) — from the terminal, your code, or an AI agent.

Discovery, browser checkout links, and machine purchases require no TixBit API key. Machine purchases require an MPP account and an explicit buyer email.

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
  --idempotency-key 11111111-1111-4111-8111-111111111111 \
  --json
```

`checkout` remains link-only: it creates a `https://www.tixbit.com/checkout/process` URL for browser completion. `purchase` is the separate public MPP machine surface. It uses the official `mppx` client to answer the server's HTTP 402 challenge and currently selects the Tempo one-time charge rail configured by the server.

`--email` is always required and is never inferred from git or local account state. If a request times out or returns `pending` or `manual_review_required`, reuse the same idempotency key and follow the returned `action`; do not start another payment.

### View venue seatmap

```sh
tixbit seatmap <event-id>
tixbit seatmap <event-id> --section <section-name>
```

### JSON output (for agents / scripting)

Every command supports `--json` for machine-readable output:

> Event IDs are normalized to public external IDs; provider prefixes are stripped from SDK/CLI results.

```sh
tixbit search "concert" --state NY --json
tixbit listings <event-id> --json
tixbit seatmap <event-id> --json
tixbit checkout <listing-id> --quantity 2 --json
tixbit purchase <listing-id> --quantity 2 --email buyer@example.com --json
```

### All commands

| Command | Description |
|---|---|
| `search [query]` | Search events by keyword, city, state, category, or date |
| `browse` | Browse upcoming events near a location |
| `listings <eventId>` | Get available ticket listings for an event |
| `checkout <listingId>` | Get a checkout link to buy tickets |
| `purchase <listingId>` | Buy a selected listing through MPP |
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
import { TixBitClient } from "tixbit";
import { Mppx, tempo } from "mppx/client";
import { resolveAccount } from "mppx/cli";

const account = await resolveAccount();
const payments = Mppx.create({
  methods: [tempo({ account })],
  polyfill: false,
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
| `paymentEndpoint` | `string` | `https://mcp.tixbit.com/api/purchase`; HTTPS TixBit hosts or loopback QA only |
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
| `TIXBIT_BASE_URL` | Override the TixBit URL | `https://www.tixbit.com` |
| `TIXBIT_PAYMENT_URL` | Override with an HTTPS TixBit endpoint or loopback URL for local QA | `https://mcp.tixbit.com/api/purchase` |
| `MPPX_PRIVATE_KEY` | Optional mppx account source; prefer the OS keychain | mppx keychain |

## Requirements

- Runtime/tooling range: Node.js `^20.19.0 || >=22.12.0`
- CI compatibility matrix: Node.js 20.19, 22, 24, and 26

Node.js 20 is end-of-life and remains in CI only as a compatibility floor. Node.js 22 and 24 are LTS releases; Node.js 26 is the current release line.

## License

[MIT](LICENSE)
