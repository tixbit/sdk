import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => { if (!process.env.TIXBIT_TEST_CLI) execFileSync("npm", ["run", "build"], { stdio: "pipe" }); }, 30000);
describe("seller CLI mocked browser-to-listing journey", () => {
  it("logs in with PKCE, previews, safely retries confirmation, reprices, delists, cancels review, and logs out", () => {
    const dir = mkdtempSync(`${tmpdir()}/tixbit-seller-journey-`);
    const log = `${dir}/requests.jsonl`;
    const id = "11111111-1111-4111-8111-111111111111";
    function run(args: string[], input = "") {
      const result = spawnSync(process.execPath, ["--import", resolve("tests/fixtures/mock-fetch.mjs"), process.env.TIXBIT_TEST_CLI ?? resolve("dist/cli.js"), "sell", ...args], {
        input, encoding: "utf8", timeout: 10000,
        env: { PATH: process.env.PATH, HOME: dir, TIXBIT_TEST_LOG: log, TIXBIT_TEST_SCENARIO: "seller-uncertain" },
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("seller_fixture");
      expect(result.stdout).not.toContain('"nonce"');
      expect(result.stdout).not.toContain('"code_verifier"');
      return { code: result.status, data: JSON.parse(result.stdout) };
    }
    try {
      expect(run(["capabilities"]).code).toBe(0);
      expect(run(["list"]).code).toBe(1);
      const login = run(["login", "--client-id", `tixbit-client.${"a".repeat(600)}.signature`]);
      const url = new URL(login.data.signInUrl);
      expect(run(["login", "--complete"], `https://mcp.tixbit.com/cli/callback?code=fixture-code&state=${url.searchParams.get("state")}`).data.signedIn).toBe(true);
      expect(run(["list"]).data.listings[0].listingId).toBe("sl_fixture");
      const body = JSON.stringify({ externalEventId: "fixture-event", section: "GA", generalAdmission: true, quantity: 2, priceCents: 15000, termsAccepted: true });
      expect(run(["create", "--dry-run"], body).data.dryRun).toBe(true);
      expect(run(["create"], body).data.review.id).toBe(id);
      expect(run(["confirm", id]).code).toBe(1);
      expect(run(["confirm", id, "--confirm"]).data.error.code).toBe("SELLER_OUTCOME_UNKNOWN");
      expect(run(["confirm", id, "--confirm"]).data.listing.listingId).toBe("sl_fixture");
      expect(run(["review", id]).data.review.status).toBe("complete");
      expect(run(["status", "sl_fixture"]).data.listing.status).toBe("live");
      for (const [operation, input] of [["reprice", { listingId: "sl_fixture", priceCents: 14000 }], ["delist", { listingId: "sl_fixture" }]] as const) {
        expect(run([operation], JSON.stringify(input)).data.review.id).toBe(id);
        expect(run(["confirm", id, "--confirm"]).code).toBe(0);
      }
      expect(run(["delist"], JSON.stringify({ listingId: "sl_fixture" })).code).toBe(0);
      expect(run(["cancel", id]).data.cancelled).toBe(true);
      expect(run(["logout"]).data.signedIn).toBe(false);
      expect(run(["list"]).code).toBe(1);
      const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const confirms = calls.filter(c => c.url.endsWith("/confirm"));
      expect(confirms[0].body).toEqual(confirms[1].body);
      expect(calls.every(c => c.url.startsWith("https://mcp.tixbit.com/"))).toBe(true);
      expect(calls.filter(c => c.url.endsWith("/prepare"))).toHaveLength(4);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
});
