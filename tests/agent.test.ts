import { afterEach, describe, expect, it, vi } from "vitest";
import { TixBitClient } from "../src/client.js";
import { assertMppChallenge, usdCents } from "../src/safety.js";

afterEach(() => vi.unstubAllGlobals());
const quote = { success: true, data: { listingId: "AbCd12", quantity: 2, currency: "usd", amountCents: 2500, maxAmountCentsSupported: true } };
const params = { listingId: "AbCd12", quantity: 2, email: "buyer@example.com", maxAmountCents: 3000 };
function mock(...bodies: unknown[]) {
  const fetch = vi.fn();
  for (const body of bodies) fetch.mockResolvedValueOnce(Response.json(body));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("agent commerce protections", () => {
  it("keeps exact event IDs and refreshes quote listings", async () => {
    const fetch = mock({ success: true, data: [], meta: { freshness: "live" } });
    await new TixBitClient().quoteListings({ eventId: "AbCd12" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/AbCd12/listings?");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("refresh=true");
  });
  it("does not pay without confirmation", async () => {
    const fetch = mock(quote);
    await new TixBitClient().buyTickets({ ...params, sharedPaymentToken: "spt_test" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[1].body)).not.toContain("spt_");
  });
  it.each([
    { amountCents: 3001 }, { currency: "eur" }, { listingId: "abcd12" },
    { quantity: 1 }, { amountCents: NaN }, { maxAmountCentsSupported: false },
  ])("blocks payment on unsafe quote %j", async (change) => {
    const fetch = mock({ ...quote, data: { ...quote.data, ...change } });
    await expect(new TixBitClient().buyTickets({ ...params, confirm: true, sharedPaymentToken: "spt_test" })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("sends cap on both requests and does not retry an ambiguous payment", async () => {
    const fetch = mock(quote);
    fetch.mockRejectedValueOnce(new Error("spt_test"));
    const result = await new TixBitClient().buyTickets({ ...params, confirm: true, sharedPaymentToken: "spt_test" });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) {
      expect(JSON.parse(call[1].body)).toMatchObject({ listingId: "AbCd12", maxAmountCents: 3000 });
      expect(call[1].redirect).toBe("error");
    }
    expect(result).toMatchObject({ success: false, status: "unknown" });
    expect(JSON.stringify(result)).not.toContain("spt_test");
  });
  it("blocks untrusted credential destinations", async () => {
    const fetch = mock();
    await expect(new TixBitClient({ baseUrl: "https://evil.example" }).buyTickets(params)).rejects.toThrow();
    await expect(new TixBitClient({ baseUrl: "https://evil.example" }).listSellerListings("secret")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not leak seller credentials through transport failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("seller_secret")));
    const error = await new TixBitClient().listSellerListings("seller_secret").catch(error => error);
    expect(String(error)).not.toContain("seller_secret");
  });
  it("requires seller confirmation and explicit terms", async () => {
    const fetch = mock();
    await expect(new TixBitClient().createSellerListing({}, "secret", false)).rejects.toThrow();
    await expect(new TixBitClient().createSellerListing({}, "secret", true)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("parses total USD without rounding or permissive number parsing", () => {
    expect(usdCents("25.01")).toBe(2501);
    for (const value of ["1e3", "1.001", "-1", "0", "Infinity", "2junk", "9007199254740991"]) expect(() => usdCents(value)).toThrow();
  });
  it("rejects nested MPP split requests before signing", () => {
    const challenge = { method: "tempo", intent: "charge", request: { amount: "25000000", currency: "0x20c0000000000000000000000000000000000000", methodDetails: { splits: [{ amount: "1000000", recipient: "0x1234" }] } } };
    expect(() => assertMppChallenge(challenge, 2500)).toThrow();
  });
  it("checks MPP atomic charge before a credential can be created", () => {
    const challenge = { method: "tempo", intent: "charge", request: { amount: "25000000", currency: "0x20c0000000000000000000000000000000000000" } };
    expect(() => assertMppChallenge(challenge, 2500)).not.toThrow();
    expect(() => assertMppChallenge(challenge, 2499)).toThrow();
    expect(() => assertMppChallenge({ ...challenge, intent: "session" }, 2500)).toThrow();
    expect(() => assertMppChallenge({ ...challenge, request: { ...challenge.request, currency: "USD" } }, 2500)).toThrow();
  });
});
