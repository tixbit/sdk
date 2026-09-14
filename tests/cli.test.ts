import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (!process.env.TIXBIT_TEST_CLI) execFileSync("npm", ["run", "build"], { stdio: "pipe" });
}, 30000);
function run(args: string[], scenario = "ok", input = "", extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(`${tmpdir()}/tixbit-cli-`);
  const log = `${dir}/requests.jsonl`;
  try {
    const result = spawnSync(process.execPath, ["--import", resolve("tests/fixtures/mock-fetch.mjs"), process.env.TIXBIT_TEST_CLI ?? resolve("dist/cli.js"), ...args], {
      input, encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, HOME: dir, TIXBIT_EMAIL: "buyer@example.com", TIXBIT_LINK_TOKEN: "spt_fixture", TIXBIT_ACCESS_TOKEN: "seller_fixture", TIXBIT_TEST_LOG: log, TIXBIT_TEST_SCENARIO: scenario, ...extraEnv },
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("spt_fixture");
    expect(result.stdout).not.toContain("seller_fixture");
    return { status: result.status, data: JSON.parse(result.stdout), calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const buy = ["buy", "AbCd12", "--quantity", "2", "--max-price", "25.00"];
describe("mocked CLI wiring", () => {
  const cleanAuth = { TIXBIT_EMAIL: "", TIXBIT_LINK_TOKEN: "", TIXBIT_ACCESS_TOKEN: "", TIXBIT_API_KEY: "" };
  it("provides public sign-in guidance without keys or a false login claim", () => {
    const r = run(["auth"], "ok", "", cleanAuth);
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(0);
    expect(r.data).toMatchObject({ apiKeyRequired: false, cliSessionSupported: false, signInUrl: "https://www.tixbit.com/sign-in" });
  });
  it.each([["search", "Fixture"], ["browse"], ["listings", "AbCd12"], ["quote", "AbCd12"], ["checkout", "AbCd12", "--quantity", "2"], ["url", "AbCd12"]])("works without credentials: %j", (...args) => {
    const r = run(args, "ok", "", cleanAuth);
    expect(r.status).toBe(0);
    for (const call of r.calls) expect(call.headers.Authorization).toBeUndefined();
  });
  it("quotes Link without credentials and checks MPP approval without an API key", () => {
    const quote = run([...buy, "--email", "buyer@example.com"], "ok", "", cleanAuth);
    expect(quote.status).toBe(0);
    expect(quote.calls).toHaveLength(1);
    expect(quote.calls[0].body.sharedPaymentToken).toBeUndefined();
    const mpp = run(["purchase", "AbCd12", "--quantity", "2", "--email", "buyer@example.com", "--max-price", "25"], "ok", "", cleanAuth);
    expect(mpp.data.error.message).toContain("--confirm");
    expect(mpp.calls).toHaveLength(0);
    const seatmap = run(["seatmap", "AbCd12"], "ok", "", cleanAuth);
    expect(seatmap.calls).toHaveLength(1);
    expect(seatmap.calls[0].headers.Authorization).toBeUndefined();
  });
  it("accepts an explicit email and hands off payment without manual token setup", () => {
    const r = run([...buy, "--email", "buyer@example.com", "--confirm"], "ok", "", cleanAuth);
    expect(r.status).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.data).toMatchObject({ success: false, status: "authorization_required", data: { checkoutUrl: "https://www.tixbit.com/checkout/process?listing=AbCd12&quantity=2" } });
    expect(r.data.action).toContain("Review and approve");
  });
  it.each([["sell", "list"], ["sell", "create", "--confirm"]])("hands off seller sign-in without reading stdin or calling a protected API: %j", (...args) => {
    const r = run(args, "ok", "", cleanAuth);
    expect(r.status).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.data.status).toBe("authorization_required");
    expect(r.data.data.signInUrl).toBe("https://www.tixbit.com/sign-in");
    expect(r.data.action).not.toContain("TIXBIT_ACCESS_TOKEN");
  });
  it("searches with exact IDs and JSON by default", () => {
    const r = run(["search", "Fixture", "--state", "GA"]);
    expect(r.status).toBe(0);
    expect(r.data.events[0].id).toBe("AbCd12");
    expect(r.calls[0].url).toContain("q=Fixture");
  });
  it("quotes full IDs using live refresh and bounded size", () => {
    const r = run(["quote", "provider-AbCd12", "--size", "100"]);
    expect(r.status).toBe(0);
    expect(r.calls[0].url).toContain("provider-AbCd12/listings?");
    expect(r.calls[0].url).toContain("refresh=true");
    expect(run(["quote", "AbCd12", "--size", "101"]).calls).toHaveLength(0);
    expect(run(["quote", "AbCd12"], "stale").status).not.toBe(0);
  });
  it("quotes without sending payment credentials", () => {
    const r = run(buy);
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].body).toEqual({ listingId: "AbCd12", quantity: 2, email: "buyer@example.com", maxAmountCents: 2500 });
  });
  it("confirms capped payment and strips token echoes", () => {
    const r = run([...buy, "--confirm"]);
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1].body.sharedPaymentToken).toBe("spt_fixture");
    expect(r.calls[1].body.maxAmountCents).toBe(2500);
    expect(r.calls[1].redirect).toBe("error");
  });
  it.each(["old-server", "overcap"])("blocks %s payment", scenario => {
    const r = run([...buy, "--confirm"], scenario);
    expect(r.status).not.toBe(0);
    expect(r.calls).toHaveLength(1);
  });
  it("never retries an ambiguous Link payment", () => {
    const r = run([...buy, "--confirm"], "ambiguous");
    expect(r.status).toBe(2);
    expect(r.data.status).toBe("unknown");
    expect(r.calls).toHaveLength(2);
    expect(r.data.action).toContain("Do not retry");
  });
  it("lists and creates through gated seller API only", () => {
    const listed = run(["sell", "list"]);
    expect(listed.status).toBe(0);
    expect(listed.calls[0].headers.Authorization).toBe("Bearer seller_fixture");
    expect(run(["sell", "create"], "ok", "{}").calls).toHaveLength(0);
    expect(run(["sell", "create", "--confirm"], "ok", "{}").calls).toHaveLength(0);
    const body = { externalEventId: "AbCd12", section: "GA", quantity: 2, priceCents: 1000, generalAdmission: true, termsAccepted: true };
    const created = run(["sell", "create", "--confirm"], "ok", JSON.stringify(body));
    expect(created.status).toBe(0);
    expect(created.calls[0].body).toEqual(body);
    expect(created.data.data.status).toBe("pending");
  });
  it.each([["--help"], ["--version"], ["url", "AbCd12", "--json"], ["browse"], ["listings", "AbCd12"], ["checkout", "AbCd12", "--quantity", "2"]])("preserves command %j with JSON", (...args) => {
    expect(run(args).status).toBe(0);
  });
  it.each([["unknown"], ["search", "--bad-option"], ["buy"], ["checkout", "AbCd12", "--quantity", "NaN"], ["buy", "sl_native", "--quantity", "2", "--max-price", "25"], ["purchase", "AbCd12", "--quantity", "2", "--email", "buyer@example.com", "--max-price", "25"]])("returns JSON error without network for %j", (...args) => {
    const r = run(args);
    expect(r.status).not.toBe(0);
    expect(r.data.success).toBe(false);
    expect(r.calls).toHaveLength(0);
  });
  it("does not disclose server errors or send credentials to untrusted hosts", () => {
    expect(run(["sell", "list"], "error").data.success).toBe(false);
    const r = run([...buy, "--confirm"], "ok", "", { TIXBIT_BASE_URL: "https://evil.example" });
    expect(r.calls).toHaveLength(0);
    expect(r.status).not.toBe(0);
  });
});
