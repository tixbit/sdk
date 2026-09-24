import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  TixBitApiError,
  TixBitClient,
  TixBitTimeoutError,
} from "../src/client.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TixBitClient", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("normalizes provider-prefixed event ids", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        events: [
          {
            id: "provider-EVENT123",
            external_event_id: "EVENT123",
            name: "Orlando Magic at Atlanta Hawks",
            date: "2026-03-16T19:00:00.000Z",
            has_listings: true,
            category_slug: "nba-basketball",
            metadata: { attraction: "Atlanta Hawks" },
            inventory: {
              total_available: 12,
              min_price: 17.57,
              max_price: 250,
              sources: { local: 2, marketplace: 10 },
            },
          },
        ],
        pagination: {
          page: 1,
          size: 1,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
          totalExact: true,
        },
      }),
    );

    const client = new TixBitClient();
    const result = await client.searchEvents({ query: "hawks", size: 1 });

    expect(result.events[0]?.id).toBe("EVENT123");
    expect(result.events[0]?.external_event_id).toBe("EVENT123");
    expect(result.events[0]?.category_slug).toBe("nba-basketball");
    expect(result.events[0]?.inventory.sources).toEqual({
      local: 2,
      marketplace: 10,
    });
  });

  it("forwards current public search filters", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        events: [],
        pagination: {
          page: 2,
          size: 200,
          total: null,
          totalPages: null,
          hasNext: true,
          hasPrev: true,
          totalExact: false,
        },
      }),
    );

    const client = new TixBitClient();
    await client.searchEvents({
      query: "jazz",
      city: "New York",
      state: "NY",
      category: "concerts",
      league: "NBA",
      categoryEventType: "CONCERT",
      performerId: "performer_1",
      venueId: "venue_1",
      parkingFilter: "include",
      nearLat: 40.7,
      nearLng: -74,
      locationMode: "manual",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      page: 2,
      size: 200,
    });

    const [input] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://www.tixbit.com");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: "jazz",
      category: "concerts",
      league: "NBA",
      categoryEventType: "CONCERT",
      performerId: "performer_1",
      venueId: "venue_1",
      parkingFilter: "include",
      nearLat: "40.7",
      nearLng: "-74",
      locationMode: "manual",
      page: "2",
      size: "200",
    });
  });

  it("gets normalized public event details", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        id: "provider-EVENT123",
        external_id: "provider-EVENT123",
        name: "Example Event",
        dates: { start: { localDate: "2026-08-01" } },
      }),
    );

    const client = new TixBitClient();
    const result = await client.getEvent("provider-EVENT123");

    expect(result.id).toBe("provider-EVENT123");
    expect(result.external_id).toBe("provider-EVENT123");
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain(
      "/api/events/provider-EVENT123",
    );
  });

  it("preserves full event ids for listings requests", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, data: [], meta: { total: 0, page: 1, size: 50 } }),
    );

    const client = new TixBitClient();
    await client.getListings({ eventId: "provider-EVENT123" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/events/provider-EVENT123/listings");
  });

  it("preserves lowercase external event ids for listings requests", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, data: [], meta: { total_count: 0, current_page_number: 1, current_page_size: 100 } }),
    );

    const client = new TixBitClient();
    await client.getListings({ eventId: "event123", size: 100 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/events/event123/listings");
    expect(String(url)).not.toContain("/api/events/EVENT123/listings");
  });

  it("maps listings pagination metadata from the live api shape", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: [{ id: "listing-1", price_per_ticket: 42, quantity: 2, listing_hash: "hash-1" }],
        meta: {
          total_count: 2272,
          current_page_number: 2,
          current_page_size: 100,
          current_page_total_count: 1,
          total_pages: 23,
          cache: true,
          cache_expires_at: "2026-08-01T00:00:00.000Z",
          cache_state: "stale",
          freshness: "cached",
        },
      }),
    );

    const client = new TixBitClient();
    const result = await client.getListings({
      eventId: "EVENT123",
      page: 2,
      size: 100,
      includeAll: true,
      refresh: true,
    });

    expect(result.listings).toHaveLength(1);
    expect(result.meta).toEqual({
      total: 2272,
      page: 2,
      size: 100,
      totalPages: 23,
      currentPageTotalCount: 1,
      cache: true,
      cacheExpiresAt: "2026-08-01T00:00:00.000Z",
      cacheState: "stale",
      freshness: "cached",
    });
    const url = new URL(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]));
    expect(url.searchParams.get("includeAll")).toBe("true");
    expect(url.searchParams.get("refresh")).toBe("true");
  });

  it("gets one public listing with disclosures", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        listing: {
          id: "LISTING123",
          event_id: "EVENT123",
          price_per_ticket: 42,
          total_price: 84,
          currency: "USD",
          quantity: 2,
          section: "A",
          seat_from: "1",
          seat_to: "2",
          disclosure_ids: ["notice_1"],
        },
        disclosures: [{ id: "notice_1", description: "Limited view" }],
      }),
    );

    const client = new TixBitClient();
    const result = await client.getListing("LISTING123");

    expect(result.listing).toMatchObject({
      id: "LISTING123",
      event_id: "EVENT123",
      price: 42,
      total_price: 84,
      currency: "USD",
      seat_from: "1",
      seat_to: "2",
      disclosure_ids: ["notice_1"],
    });
    expect(result.disclosures).toEqual([
      { id: "notice_1", description: "Limited view" },
    ]);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain(
      "/api/listings/LISTING123",
    );
  });

  it("preserves browse pagination and recommendation filters", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        events: [],
        total: null,
        totalExact: false,
        hasMore: true,
        page: 2,
        pageSize: 10,
        degraded: true,
      }),
    );

    const client = new TixBitClient();
    const result = await client.browse({
      query: "baseball",
      category: "mlb-baseball",
      league: "MLB",
      page: 2,
      size: 10,
      city: "Atlanta",
      state: "GA",
      context: "events",
      recommendation: "trending",
      parkingFilter: "exclude",
      locationMode: "manual",
    });

    expect(result).toMatchObject({
      total: null,
      totalExact: false,
      hasMore: true,
      page: 2,
      pageSize: 10,
      degraded: true,
    });
    const url = new URL(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      query: "baseball",
      category: "mlb-baseball",
      league: "MLB",
      page: "2",
      size: "10",
      preferCity: "Atlanta",
      preferState: "GA",
      context: "events",
      recommendation: "trending",
      parkingFilter: "exclude",
      locationMode: "manual",
    });
  });

  it("creates only validated canonical browser checkout links", () => {
    const client = new TixBitClient();
    expect(
      client.createCheckoutLink({ listingId: "LISTING_123", quantity: 2 }),
    ).toEqual({
      url: "https://www.tixbit.com/checkout/process?listing=LISTING_123&quantity=2",
      listingId: "LISTING_123",
      quantity: 2,
    });
    expect(() =>
      client.createCheckoutLink({ listingId: "../purchase", quantity: 2 }),
    ).toThrow(TypeError);
    expect(() =>
      client.createCheckoutLink({ listingId: "LISTING123", quantity: 9 }),
    ).toThrow(RangeError);
  });

  it("returns a redacted MPP requirement with a normalized email and stable idempotency key", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "payment_required",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          orderReference: "TBM-A23456789B",
          receiptUrl: null,
          order: {
            reference: "TBM-A23456789B",
            status: "payment_required",
            listingId: "LISTING123",
            quantity: 2,
            pricePerTicket: 125,
            subtotal: 250,
            fees: 25,
            total: 275,
            currency: "USD",
          },
        }),
        {
          status: 402,
          headers: { "www-authenticate": 'Payment id="challenge-1"' },
        },
      ),
    );
    const client = new TixBitClient();

    const result = await client.purchaseTickets({
      listingId: "LISTING123",
      quantity: 2,
      email: "  FAN@Example.com ",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).toMatchObject({
      success: false,
      status: "payment_required",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      orderReference: "TBM-A23456789B",
      order: { total: 275, fees: 25 },
    });
    expect(result).not.toHaveProperty("challenge");
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(init?.redirect).toBe("error");
    expect(init?.headers).not.toHaveProperty("X-TixBit-Api-Key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      listingId: "LISTING123",
      quantity: 2,
      email: "fan@example.com",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("returns a fulfilled agent-readable result from an MPP-enabled fetch", async () => {
    const paymentFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        status: "fulfilled",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        orderReference: "TBM-C23456789D",
        receiptUrl: "https://receipts.example/receipt-2",
        order: {
          reference: "TBM-C23456789D",
          status: "fulfilled",
          listingId: "LISTING123",
          quantity: 1,
          pricePerTicket: 125,
          subtotal: 125,
          fees: 12.5,
          total: 137.5,
          currency: "USD",
        },
      }),
    );
    const client = new TixBitClient({
      paymentFetch,
    });

    await expect(
      client.purchaseTickets({
        listingId: "LISTING123",
        quantity: 1,
        email: "fan@example.com",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toMatchObject({
      success: true,
      status: "fulfilled",
      orderReference: "TBM-C23456789D",
      receiptUrl: "https://receipts.example/receipt-2",
    });
    expect(paymentFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe payment endpoints before sending a request", () => {
    expect(
      () =>
        new TixBitClient({
          paymentEndpoint: "http://attacker.example/purchase",
        }),
    ).toThrow("paymentEndpoint must use HTTPS");
    expect(
      () =>
        new TixBitClient({
          paymentEndpoint: "https://user:secret@example.com/purchase",
        }),
    ).toThrow("must not contain credentials");
    expect(
      () =>
        new TixBitClient({
          paymentEndpoint: "https://attacker.example/purchase",
        }),
    ).toThrow("must use a TixBit host");
    expect(
      () =>
        new TixBitClient({
          paymentEndpoint: "http://127.0.0.1:3002/api/purchase",
        }),
    ).not.toThrow();
  });

  it("redacts unknown response fields and treats server failures as ambiguous", async () => {
    const paymentFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            status: "fulfilled",
            orderReference: "TBM-E23456789F",
            providerPurchaseId: "provider-secret",
            internalDebug: { orderToken: "one-shot-secret" },
          },
          500,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          status: "fulfilled",
          orderReference: "TBM-G23456789H",
          receiptUrl: "https://receipts.example/receipt-4",
          providerPurchaseId: "provider-secret",
          internalDebug: { orderToken: "one-shot-secret" },
        }),
      );
    const client = new TixBitClient({
      paymentFetch,
    });

    const failed = await client.purchaseTickets({
      listingId: "LISTING123",
      quantity: 1,
      email: "fan@example.com",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
    expect(failed).toMatchObject({
      success: false,
      status: "pending",
      error: { code: "PURCHASE_OUTCOME_AMBIGUOUS" },
      action: expect.stringContaining("Do not create a new payment"),
    });
    expect(failed).not.toHaveProperty("providerPurchaseId");
    expect(failed).not.toHaveProperty("internalDebug");

    const fulfilled = await client.purchaseTickets({
      listingId: "LISTING123",
      quantity: 1,
      email: "fan@example.com",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    });
    expect(fulfilled).toMatchObject({
      success: true,
      status: "fulfilled",
      orderReference: "TBM-G23456789H",
    });
    expect(fulfilled).not.toHaveProperty("providerPurchaseId");
    expect(fulfilled).not.toHaveProperty("internalDebug");
  });

  it("preserves a paid manual review result on HTTP 502", async () => {
    const paymentFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "manual_review_required", orderReference: "TBM-E23456789F" }, 502),
    );
    const client = new TixBitClient({ paymentFetch });

    await expect(client.purchaseTickets({
      listingId: "LISTING123",
      quantity: 1,
      email: "fan@example.com",
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    })).resolves.toMatchObject({
      status: "manual_review_required",
      paid: true,
      orderReference: "TBM-E23456789F",
    });
  });

  it("keeps fulfilled responses without an order reference pending", async () => {
    const paymentFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ success: true, status: "fulfilled" }),
    );
    const client = new TixBitClient({
      paymentFetch,
    });

    await expect(
      client.purchaseTickets({
        listingId: "LISTING123",
        quantity: 1,
        email: "fan@example.com",
        idempotencyKey: "66666666-6666-4666-8666-666666666666",
      }),
    ).resolves.toMatchObject({
      success: false,
      status: "pending",
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
      orderReference: null,
      error: { code: "PURCHASE_OUTCOME_AMBIGUOUS" },
      action: expect.stringContaining("Do not create a new payment"),
    });
  });

  it("keeps fulfilled responses with a provider-shaped reference pending", async () => {
    const paymentFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        status: "fulfilled",
        orderReference: "provider-purchase-123",
      }),
    );
    const client = new TixBitClient({
      paymentFetch,
    });

    await expect(
      client.purchaseTickets({
        listingId: "LISTING123",
        quantity: 1,
        email: "fan@example.com",
        idempotencyKey: "77777777-7777-4777-8777-777777777777",
      }),
    ).resolves.toMatchObject({
      success: false,
      status: "pending",
      orderReference: null,
      error: { code: "PURCHASE_OUTCOME_AMBIGUOUS" },
    });
  });

  it("returns pending on a timeout or network ambiguity and preserves the retry key", async () => {
    const paymentFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
    const client = new TixBitClient({
      paymentFetch,
    });

    await expect(
      client.purchaseTickets({
        listingId: "LISTING123",
        quantity: 1,
        email: "fan@example.com",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      }),
    ).resolves.toMatchObject({
      success: false,
      status: "pending",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      error: { code: "PURCHASE_NETWORK_ERROR" },
    });
  });

  it("rejects missing or invalid email before issuing a payment request", async () => {
    const paymentFetch = vi.fn<typeof fetch>();
    const client = new TixBitClient({
      paymentFetch,
    });

    await expect(
      client.purchaseTickets({
        listingId: "LISTING123",
        quantity: 1,
        email: "not-an-email",
      }),
    ).rejects.toThrow("email must be a valid email address");
    await expect(
      client.purchaseTickets({
        listingId: "LISTING123",
        quantity: 1,
        email: "",
      }),
    ).rejects.toThrow("email must be a valid email address");
    await expect(
      client.purchaseTickets({
        listingId: "LISTING123",
        quantity: 1,
        email: "fan@example.com",
        idempotencyKey: "order-attempt-123",
      }),
    ).rejects.toThrow("idempotencyKey must be an unguessable UUID v4");
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("returns typed HTTP and timeout errors", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "Unavailable" }, 503))
      .mockImplementationOnce((_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
      );

    const client = new TixBitClient({ timeoutMs: 5 });
    const apiError = await client.getEvent("EVENT123").catch((error) => error);
    expect(apiError).toBeInstanceOf(TixBitApiError);
    expect(apiError).toMatchObject({ status: 503 });

    const timeoutError = await client.getEvent("EVENT123").catch((error) => error);
    expect(timeoutError).toBeInstanceOf(TixBitTimeoutError);
    expect(timeoutError).toMatchObject({ timeoutMs: 5 });
  });

  it("returns absolute seatmap asset URLs and section shape paths", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          event_id: "provider-EVENT123",
          venue_id: "2D2ZBN6G",
          venue_name: "State Farm Arena",
          configuration_id: "VGJBV",
          configuration_name: "NBA - Atlanta Hawks",
          background_image: "/api/seatmap/assets?url=bg",
          coordinates_url: "/api/seatmap/assets?url=coords",
          has_coordinates: true,
          capacity: 18118,
          venue_data: {
            name: "State Farm Arena",
            address: "1 Philips Dr Nw",
            city: "Atlanta",
            region: "GA",
            country: "US",
            time_zone: "America/New_York",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          zones: [
            {
              id: "zone-1",
              name: "Section",
              sections: [
                {
                  id: "80850",
                  name: "204",
                  labels: [
                    { text: "Other", x: 1, y: 1 },
                    { text: "204", x: 134.5, y: 302.6, size: 19.9, angle: 0 },
                  ],
                  shape: {
                    path: "M127,244.8L200,300Z",
                  },
                },
              ],
            },
          ],
        }),
      );

    const client = new TixBitClient({ baseUrl: "https://www.tixbit.com" });
    const result = await client.getSeatmap({ eventId: "provider-EVENT123" });

    expect(result.event_id).toBe("provider-EVENT123");
    expect(result.background_image).toBe("https://www.tixbit.com/api/seatmap/assets?url=bg");
    expect(result.coordinates_url).toBe("https://www.tixbit.com/api/seatmap/assets?url=coords");
    expect(result.section_names).toContain("204");
    expect(result.zones[0]?.sections[0]?.shape_path).toBe("M127,244.8L200,300Z");
    expect(result.zones[0]?.sections[0]?.labels).toHaveLength(2);
    expect(result.zones[0]?.sections[0]?.x).toBe(134.5);
    expect(result.zones[0]?.sections[0]?.y).toBe(302.6);
  });

  it("reads the CLI version from package.json", () => {
    const cliSource = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(cliSource).toContain('.version(packageJson.version)');
    expect(cliSource).not.toMatch(/\.version\(["']\d/);
  });
});
