# @tixbit/sdk

Search events, view seatmaps, browse listings, and buy tickets on [TixBit](https://tixbit.com) — from the terminal, your code, or an AI agent.

No API key required.

## Install

```sh
# Use instantly with npx (no install)
npx @tixbit/sdk search "Hawks" --state GA

# Or install globally
npm install -g @tixbit/sdk
tixbit search "Hawks" --state GA

# Or add to a project
npm install @tixbit/sdk
```

## CLI

### Search events

```sh
tixbit search "Taylor Swift"
tixbit search "Hawks" --state GA --size 5
tixbit search --city "New York" --category nba-basketball
tixbit search --start-date 2025-06-01 --end-date 2025-06-30
```

### Browse local events

```sh
tixbit browse --city Atlanta --state GA
tixbit browse --lat 33.749 --lng -84.388 --category CONCERT
```

### Get ticket listings

```sh
tixbit listings 4BKJMDZ
tixbit listings 4BKJMDZ --size 5 --sort asc
```

### View venue seatmap

```sh
tixbit seatmap 4BKJMDZ
tixbit seatmap 4BKJMDZ --section 214
```

```
🏟  State Farm Arena
   NBA - Atlanta Hawks
   1 Philips Dr Nw, Atlanta, GA
   Capacity: 18,118

  ── 🏀 Floor ──
     FLOOR1  FLOOR2  FLOOR3  ...

  ── ⬇ Lower Level (100s) ──
     101  102  103  104  ...  122

  ── ⬆ Upper Level (200s) ──
     201  202  203  ▸214◂  ...  227S

  📍 Section 214: right side

  Total sections: 142
```

### JSON output (for agents / scripting)

Every command supports `--json` for machine-readable output:

```sh
tixbit search "concert" --state NY --json
tixbit listings 4BKJMDZ --json
tixbit seatmap 4BKJMDZ --json
```

### All commands

| Command | Description |
|---|---|
| `search [query]` | Search events by keyword, city, state, category, or date |
| `browse` | Browse upcoming events near a location |
| `listings <eventId>` | Get available ticket listings for an event |
| `seatmap <eventId>` | Show the venue seating chart with all sections |
| `url <slug>` | Print the TixBit event page URL |

## SDK

Use the client programmatically in any Node.js 20+ project:

```ts
import { TixBitClient } from "@tixbit/sdk";

const tixbit = new TixBitClient();

// Search events
const { events } = await tixbit.searchEvents({
  query: "Hawks",
  state: "GA",
  size: 5,
});

// Get listings
const { listings } = await tixbit.getListings({
  eventId: events[0].external_event_id,
});

// View seatmap
const seatmap = await tixbit.getSeatmap({
  eventId: events[0].external_event_id,
});
console.log(seatmap.venue_name);    // "State Farm Arena"
console.log(seatmap.section_names); // ["101", "102", ...]

// Browse nearby
const nearby = await tixbit.browse({
  city: "Atlanta",
  state: "GA",
});

// Event URL
const url = tixbit.eventUrl("4BKJMDZ");
// → "https://tixbit.com/events/4BKJMDZ"
```

## API Reference

### `new TixBitClient(config?)`

| Option | Type | Default |
|---|---|---|
| `baseUrl` | `string` | `https://tixbit.com` |
| `timeoutMs` | `number` | `15000` |
| `apiKey` | `string` | — |

### `searchEvents(params?)`

| Param | Type | Description |
|---|---|---|
| `query` | `string` | Free-text search |
| `city` | `string` | City name |
| `state` | `string` | 2-letter state code |
| `category` | `string` | Category slug (e.g. `nba-basketball`) |
| `startDate` | `string` | ISO date — events on/after |
| `endDate` | `string` | ISO date — events on/before |
| `page` | `number` | Page number (default: 1) |
| `size` | `number` | Results per page (default: 25) |

### `browse(params?)`

| Param | Type | Description |
|---|---|---|
| `city` | `string` | Preferred city |
| `state` | `string` | Preferred state |
| `latitude` | `number` | Latitude |
| `longitude` | `number` | Longitude |
| `categoryEventType` | `string` | `SPORT`, `CONCERT`, `THEATER`, or `ALL` |
| `size` | `number` | Number of results (default: 18) |

### `getListings(params)`

| Param | Type | Description |
|---|---|---|
| `eventId` | `string` | External event ID |
| `size` | `number` | Page size (default: 50) |
| `page` | `number` | Page number (default: 1) |
| `orderByDirection` | `string` | `asc` or `desc` by price |

### `getSeatmap(params)`

| Param | Type | Description |
|---|---|---|
| `eventId` | `string` | External event ID |

Returns venue info, section list, zone groupings, and background image URL.

### `eventUrl(slugOrId)`

Returns the full URL to the event page on tixbit.com.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `TIXBIT_BASE_URL` | Override the TixBit URL | `https://tixbit.com` |
| `TIXBIT_API_KEY` | API key (reserved for future use) | — |

## Requirements

- Node.js 20+

## License

[MIT](LICENSE)
