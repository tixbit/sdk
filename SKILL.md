---
name: tixbit-sdk
description: Use the official TixBit SDK/CLI to search events, browse by location, inspect listings, view seatmaps, and generate checkout links. Trigger when a user asks to find tickets, compare sections/prices, or create a TixBit checkout URL.
---

# TixBit SDK Skill

Use the official CLI package:

```bash
npx -y @tixbit/sdk <command>
```

Prefer `--json` for agent-readable output.

## Core commands

```bash
# Search events
npx -y @tixbit/sdk search "Braves" --city Atlanta --state GA --size 10 --json

# Browse local events
npx -y @tixbit/sdk browse --city Atlanta --state GA --json

# Listings for an event
npx -y @tixbit/sdk listings <eventId> --size 10 --sort asc --json

# Venue seatmap
npx -y @tixbit/sdk seatmap <eventId> --json

# Checkout link for a listing
npx -y @tixbit/sdk checkout <listingId> --quantity 2 --json

# Event URL
npx -y @tixbit/sdk url <slugOrId>
```

## Notes

- No API key is required for standard public ticket discovery.
- `checkout` returns a link; payment is completed by the user in browser.
- Optional env vars: `TIXBIT_BASE_URL`, `TIXBIT_API_KEY`.
