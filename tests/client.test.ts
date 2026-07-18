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

    expect(result.id).toBe("EVENT123");
    expect(result.external_id).toBe("EVENT123");
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toContain(
      "/api/events/EVENT123",
    );
  });

  it("uses normalized event ids for listings requests", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, data: [], meta: { total: 0, page: 1, size: 50 } }),
    );

    const client = new TixBitClient();
    await client.getListings({ eventId: "provider-EVENT123" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/events/EVENT123/listings");
    expect(String(url)).not.toContain("provider-EVENT123");
  });

  it("uppercases lowercase external event ids for listings requests", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, data: [], meta: { total_count: 0, current_page_number: 1, current_page_size: 100 } }),
    );

    const client = new TixBitClient();
    await client.getListings({ eventId: "event123", size: 100 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/events/EVENT123/listings");
    expect(String(url)).not.toContain("/api/events/event123/listings");
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
      client.createCheckoutLink({ listingId: " LISTING_123 ", quantity: 2 }),
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

    expect(result.event_id).toBe("EVENT123");
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
