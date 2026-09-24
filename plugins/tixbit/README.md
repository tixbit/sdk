# TixBit plugin

A skills-only plugin for ChatGPT and Codex. Find event tickets, compare listings
and venue sections, generate browser checkout links, or integrate the public
TixBit SDK into Node.js applications. Requires Node.js 20+, npm, and HTTPS access.
No TixBit developer key is required. Users complete payment on the TixBit website.

## Package

From the SDK repository root:

```sh
python3 - <<'PYCODE'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path("plugins/tixbit")
with ZipFile("tixbit-plugin-0.1.0.zip", "w", ZIP_DEFLATED) as archive:
    for source in sorted(root.rglob("*")):
        if source.is_file():
            archive.write(source, source.relative_to(root))
PYCODE
```

The archive includes a portable root `plugin.json`, a Codex compatibility
manifest, two skills, their reference example, a logo, and the MIT license.
It contains no MCP configuration, credentials, hooks, or SDK runtime binaries.
The skills install/use `tixbit@0.1.1`, the published npm release verified on
2026-09-22. Source version 0.1.2 has not been published to npm as of that check.

Upload through **Skills only** at https://platform.openai.com/plugins.
See `../../docs/plugin-submission.md` for listing copy and reviewer test cases.
A local archive is not an approved or published directory listing.

## Later MCP version

Submit https://mcp.tixbit.com/api/mcp through **With MCP** after restoring and
validating its initialize, tools, and widget responses. Keep the skill bundle
with that submission. Do not reference an existing connector ID in `.app.json`.

## Data and support

Search criteria and selected event/listing IDs are sent to TixBit. This version
does not submit buyer identity or payment details. The developer workflow also
uses npm to install the public package. See https://www.tixbit.com/privacy,
https://www.tixbit.com/terms, and https://www.tixbit.com/support.
