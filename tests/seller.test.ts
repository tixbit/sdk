import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SellerClient, SellerStore, normalizeSellerOperation, SELLER_CALLBACK, SELLER_ORIGIN, SELLER_SCOPES } from "../src/seller.js";

const reviewId = "11111111-1111-4111-8111-111111111111";
const attempt = "22222222-2222-4222-8222-222222222222";
const listing = { listingId: "sl_fixture", status: "live", quantity: 2, priceCents: 10000 };
const body = { externalEventId: "event-Fixture", section: "101", row: "B", seatNumbers: ["1", "2"], quantity: 2, priceCents: 10000, termsAccepted: true };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "tixbit-seller-")); dirs.push(dir);
  const store = new SellerStore(dir);
  const fetcher = vi.fn();
  const client = new SellerClient(store, fetcher);
  return { client, store, fetcher, dir };
}
async function session(store: SellerStore) { await store.save("session.json", { accessToken: "secret_fixture", expiresAt: Date.now() + 60000, clientId: "approved_fixture" }); }
function prepared(operation = "seller.create", input: unknown = body) { return { review: { id: reviewId, operation: { name: operation, body: input }, expiresAt: Date.now() + 60000 }, confirmation: { reviewId, nonce: "x".repeat(43) } }; }

describe("seller workflow contract", () => {
  it("discovers capabilities anonymously and denies protected reads before network", async () => {
    const { client, fetcher } = await setup();
    fetcher.mockResolvedValueOnce(Response.json({ configured: false, quantityUpdate: false }));
    expect(await client.capabilities()).toMatchObject({ configured: false });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
    await expect(client.inventory()).rejects.toMatchObject({ code: "LOCAL_STATE_MISSING" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown selling fields, quantity edits, fractional cents and ambiguous seats", () => {
    expect(() => normalizeSellerOperation("seller.create", { ...body, fulfillment: "instant" })).toThrow("Unsupported");
    expect(() => normalizeSellerOperation("seller.reprice", { listingId: "sl_fixture", priceCents: 1000, quantity: 2 })).toThrow("Quantity edits");
    expect(() => normalizeSellerOperation("seller.create", { ...body, priceCents: 100.5 })).toThrow();
    expect(() => normalizeSellerOperation("seller.create", { ...body, termsAccepted: false })).toThrow();
    expect(() => normalizeSellerOperation("seller.create", { ...body, seatNumbers: ["1", "1"] })).toThrow();
    expect(() => normalizeSellerOperation("seller.create", { ...body, quantity: 21 })).toThrow();
    expect(() => normalizeSellerOperation("seller.delist", { listingId: "bad\nID" })).toThrow();
  });
  it("runs mocked create, repricing, delisting with exact prepared operation and safe confirm retry", async () => {
    const { client, store, fetcher } = await setup(); await session(store);
    fetcher.mockResolvedValueOnce(Response.json(prepared()));
    const preview = await client.prepare("seller.create", body, attempt);
    expect(JSON.stringify(preview)).not.toContain("nonce");
    expect(JSON.stringify(preview)).not.toContain("secret_fixture");
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ operation: "seller.create", body, attempt });
    await expect(client.confirm(reviewId, false)).rejects.toThrow("Explicit approval");
    fetcher.mockRejectedValueOnce(new Error("secret_fixture"));
    await expect(client.confirm(reviewId, true)).rejects.toMatchObject({ code: "SELLER_OUTCOME_UNKNOWN", retryable: true });
    fetcher.mockResolvedValueOnce(Response.json({ listing }));
    expect(await client.confirm(reviewId, true)).toEqual({ listing });
    const calls = fetcher.mock.calls.slice(1);
    expect(calls[0][1].body).toEqual(calls[1][1].body);
    expect(JSON.parse(calls[1][1].body)).toEqual({ reviewId, nonce: "x".repeat(43) });
    for (const [index, operation] of ["seller.reprice", "seller.delist"].entries()) {
      const input = operation === "seller.reprice" ? { listingId: "sl_fixture", priceCents: 12000 } : { listingId: "sl_fixture" };
      fetcher.mockResolvedValueOnce(Response.json(prepared(operation, input)));
      await client.prepare(operation as any, input, `${index + 3}2222222-2222-4222-8222-222222222222`);
      fetcher.mockResolvedValueOnce(Response.json({ listing: { ...listing, status: operation === "seller.delist" ? "delisted" : "live" } }));
      await client.confirm(reviewId, true);
    }
  });
  it("does not repeat a lost preparation and gives server ownership denial without leaking reflected credentials", async () => {
    const { client, store, fetcher } = await setup(); await session(store);
    fetcher.mockRejectedValueOnce(new Error("secret_fixture"));
    await expect(client.prepare("seller.create", body, attempt)).rejects.toMatchObject({ code: "SELLER_OUTCOME_UNKNOWN" });
    await expect(client.prepare("seller.create", body, attempt)).rejects.toMatchObject({ code: "ATTEMPT_ALREADY_SENT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "permission_required", message: "secret_fixture", action: "secret_fixture" } }, { status: 403 }));
    const error = await client.inventory().catch(e => e);
    expect(error.code).toBe("permission_required");
    expect(error.action).toContain("ownership");
    expect(String(error)).not.toContain("secret_fixture");
  });
  it.each([
    ["review_conflict", 409, false, "Retain the existing confirmation"],
    ["account_unavailable", 503, false, "SAME review ID"],
    ["invalid_request", 400, false, "price in cents"],
    ["permission_required", 403, false, "ownership"],
  ])("preserves recognized lowercase API code %s with static safe recovery", async (code, status, retryable, recovery) => {
    const { client, store, fetcher } = await setup(); await session(store);
    await store.save(`review-${reviewId}.json`, prepared());
    fetcher.mockResolvedValueOnce(Response.json({ error: { code, retryable, message: "secret_fixture reflected message", action: "secret_fixture reflected action" } }, { status }));
    const error = await client.confirm(reviewId, true).catch(e => e);
    expect(error).toMatchObject({ code, retryable });
    expect(error.action).toContain(recovery);
    expect(JSON.stringify({ message: error.message, action: error.action })).not.toContain("secret_fixture");
  });
  it("honors recognized retryable reads but discards unknown server codes and guidance", async () => {
    const { client, store, fetcher } = await setup(); await session(store);
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "account_unavailable", retryable: true } }, { status: 503 }));
    await expect(client.inventory()).rejects.toMatchObject({ code: "account_unavailable", retryable: true });
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "secret_fixture", message: "secret_fixture", action: "secret_fixture", retryable: true } }, { status: 503 }));
    const error = await client.inventory().catch(e => e);
    expect(error).toMatchObject({ code: "SELLER_HTTP_503", retryable: false });
    expect(JSON.stringify({ message: error.message, action: error.action })).not.toContain("secret_fixture");
  });
  it("only reports owned inventory and cancels preparation without delisting", async () => {
    const { client, store, fetcher } = await setup(); await session(store);
    fetcher.mockResolvedValueOnce(Response.json({ listings: [listing] }));
    await expect(client.status("other_seller_listing")).rejects.toMatchObject({ code: "LISTING_NOT_FOUND" });
    await store.save(`review-${reviewId}.json`, prepared());
    fetcher.mockResolvedValueOnce(Response.json({ cancelled: true }));
    expect(await client.cancel(reviewId)).toEqual({ cancelled: true });
    expect(fetcher.mock.calls[1][0]).toBe(`${SELLER_ORIGIN}/api/seller/cancel`);
  });
});

describe("CLI seller OAuth PKCE", () => {
  it("binds HTTPS callback, state, S256, resource and scopes; stores token privately and logs out", async () => {
    const { client, store, fetcher, dir } = await setup();
    const started = await client.startLogin(`tixbit-client.${"a".repeat(1000)}.signature`);
    const auth = new URL(started.signInUrl);
    expect(auth.origin).toBe(SELLER_ORIGIN);
    expect(auth.pathname).toBe("/api/oauth/authorize");
    expect(auth.searchParams.get("redirect_uri")).toBe(SELLER_CALLBACK);
    expect(auth.searchParams.get("resource")).toBe(`${SELLER_ORIGIN}/api/mcp`);
    expect(auth.searchParams.get("scope")).toBe(SELLER_SCOPES);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(started.signInUrl).not.toContain("verifier");
    fetcher.mockResolvedValueOnce(Response.json({ access_token: "secret_fixture", token_type: "Bearer", expires_in: 3600 }));
    const result = await client.completeLogin(`${SELLER_CALLBACK}?code=code_fixture&state=${auth.searchParams.get("state")}`);
    expect(JSON.stringify(result)).not.toContain("secret_fixture");
    const form = fetcher.mock.calls[0][1].body as URLSearchParams;
    expect(form.get("code_verifier")).toHaveLength(43);
    expect(form.get("resource")).toBe(`${SELLER_ORIGIN}/api/mcp`);
    expect((await stat(join(dir, "session.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(await client.authStatus()).toMatchObject({ signedIn: true });
    await client.logout();
    await expect(store.load("session.json")).rejects.toThrow();
  });
  it.each(["https://evil.example/cli/callback", "http://mcp.tixbit.com/cli/callback", "http://localhost:3000/cli/callback", SELLER_CALLBACK])("rejects untrusted callback or mismatched state %s", async (url) => {
    const { client, fetcher } = await setup(); await client.startLogin("approved_fixture");
    await expect(client.completeLogin(`${url}?code=code_fixture&state=wrong`)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects expired sessions and never treats browser or environment tokens as a login", async () => {
    const { client, store, fetcher } = await setup();
    await store.save("session.json", { accessToken: "secret_fixture", expiresAt: Date.now() - 1 });
    await expect(client.inventory()).rejects.toMatchObject({ code: "SELLER_LOGIN_EXPIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
