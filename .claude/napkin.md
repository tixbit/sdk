# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|

## User Preferences
- Keep answers grounded in the repo and verify behavior against live TixBit data when the question is about endpoint limits.

## Patterns That Work
- `src/client.ts#getListings` is paginated and forwards `size` and `page` directly to `/api/events/:eventId/listings`.
- `src/cli.ts` defaults `tixbit listings` to `--size 20 --page 1`, so the CLI only returns the first page unless callers paginate explicitly.
- The live listings API caps page size at 100 even if callers request a larger `size`.

## Patterns That Don't Work
- Assuming the listings command returns the full inventory without checking `meta.total`, `meta.page`, and `meta.size`.
- Using the lowercase event id from a public slug can produce misleading listings results; the live API returned correct totals for uppercase `PDGV2Z63` but not for lowercase `pdgv2z63`.

## Domain Notes
- Event IDs in the SDK/CLI are normalized external IDs; provider prefixes are stripped before the listings request is sent.
- A fresh checkout may not have `node_modules`; `npm run build` failed here because `tsup` was not installed.
- `npm run typecheck` is currently red for repo-baseline CLI issues in `src/cli.ts`, including missing `@types/node` and existing Commander option typing mismatches.
