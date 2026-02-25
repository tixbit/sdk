import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: false,
    target: "node20",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    target: "node20",
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
