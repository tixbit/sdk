import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TixBitClient } from "../src/client.js";

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
            id: "provider-36PB9ZN",
            external_event_id: "36PB9ZN",
            name: "Orlando Magic at Atlanta Hawks",
            date: "2026-03-16T19:00:00.000Z",
            has_listings: true,
            inventory: { total_available: 12, min_price: 17.57, max_price: 250 },
          },
        ],
        pagination: {
          page: 1,
          size: 1,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      }),
    );

    const client = new TixBitClient();
    const result = await client.searchEvents({ query: "hawks", size: 1 });

    expect(result.events[0]?.id).toBe("36PB9ZN");
    expect(result.events[0]?.external_event_id).toBe("36PB9ZN");
  });

  it("uses normalized event ids for listings requests", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, data: [], meta: { total: 0, page: 1, size: 50 } }),
    );

    const client = new TixBitClient();
    await client.getListings({ eventId: "provider-36PB9ZN" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/events/36PB9ZN/listings");
    expect(String(url)).not.toContain("provider-36PB9ZN");
  });

  it("returns absolute seatmap asset URLs and section shape paths", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          event_id: "provider-36PB9ZN",
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

    const client = new TixBitClient({ baseUrl: "https://tixbit.com" });
    const result = await client.getSeatmap({ eventId: "provider-36PB9ZN" });

    expect(result.event_id).toBe("36PB9ZN");
    expect(result.background_image).toBe("https://tixbit.com/api/seatmap/assets?url=bg");
    expect(result.coordinates_url).toBe("https://tixbit.com/api/seatmap/assets?url=coords");
    expect(result.section_names).toContain("204");
    expect(result.zones[0]?.sections[0]?.shape_path).toBe("M127,244.8L200,300Z");
    expect(result.zones[0]?.sections[0]?.labels).toHaveLength(2);
    expect(result.zones[0]?.sections[0]?.x).toBe(134.5);
    expect(result.zones[0]?.sections[0]?.y).toBe(302.6);
  });
});
