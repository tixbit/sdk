# Contributing to @tixbit/sdk

Thanks for your interest in contributing! Here's how to get started.

## Setup

```sh
git clone https://github.com/tixbit/sdk.git
cd sdk
npm ci
npm run build
```

## Development

```sh
# Build once
npm run build

# Watch mode
npm run dev

# Type-check
npm run typecheck

# Run tests
npm test

# Test the CLI locally
node dist/cli.js search "Hawks" --state GA
```

## Project Structure

```
src/
  types.ts    — All TypeScript interfaces (events, listings, seatmaps)
  client.ts   — TixBitClient HTTP client class
  cli.ts      — Commander-based CLI (search, browse, listings, seatmap, url)
  index.ts    — Public SDK exports
```

## Guidelines

- **TypeScript strict mode** — no `any`, no `@ts-ignore`
- **Zero runtime dependencies** beyond `commander` (for the CLI)
- **Node `^20.19.0 || >=22.12.0`** — use native `fetch`, no polyfills
- **CI matrix** — Node 20.19, 22, 24, and 26; Node 20 is compatibility-only because it is end-of-life
- **Both outputs matter** — human-readable for terminals, `--json` for agents/piping
- Run `npm run typecheck` before submitting a PR

## Adding a new command

1. Add types to `src/types.ts`
2. Add the client method to `src/client.ts`
3. Add the CLI command to `src/cli.ts`
4. Export new types from `src/index.ts`
5. Update README.md

## Reporting Issues

Open an issue at [github.com/tixbit/sdk/issues](https://github.com/tixbit/sdk/issues).
