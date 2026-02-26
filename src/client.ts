// ─────────────────────────────────────────────────────────────────────────────
// @tixbit/sdk — Client
//
// Standalone HTTP client for the TixBit public API. Zero internal dependencies.
// Works from any Node.js 20+ environment, CLI, or agent runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  TixBitConfig,
  SearchEventsParams,
  SearchEventsResult,
  TixBitEvent,
  GetListingsParams,
  GetListingsResult,
  TixBitListing,
  BrowseEventsParams,
  BrowseEventsResult,
  GetSeatmapParams,
  SeatmapResult,
  SeatmapZone,
  SeatmapSection,
  CheckoutParams,
  CheckoutLink,
} from "./types.js";

const DEFAULT_BASE_URL = "https://tixbit.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = "@tixbit/sdk";

function normalizeExternalEventId(eventId: string): string {
  if (!eventId) return eventId;

  const trimmed = eventId.trim();
  const providerPrefixedId = trimmed.match(/^([a-z]{5,})-([A-Z0-9]{6,})$/i);
  if (providerPrefixedId?.[2]) {
    return providerPrefixedId[2];
  }

  return trimmed;
}

function toAbsoluteUrl(baseUrl: string, value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `${baseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

export class TixBitClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(config: TixBitConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.apiKey = config.apiKey;
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };

    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string>) },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new TixBitApiError(
          `${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
          res.status,
          url,
        );
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private qs(params: Record<string, string | number | boolean | undefined>): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return entries.length ? `?${entries.join("&")}` : "";
  }

  // ── Search Events ─────────────────────────────────────────────────────────

  /**
   * Search for events by keyword, city, state, category, or date range.
   *
   * @example
   * ```ts
   * const results = await client.searchEvents({ query: "Hawks", state: "GA" });
   * ```
   */
  async searchEvents(params: SearchEventsParams = {}): Promise<SearchEventsResult> {
    const query = this.qs({
      q: params.query,
      city: params.city,
      state: params.state,
      category: params.category,
      startDate: params.startDate,
      endDate: params.endDate,
      page: params.page,
      size: params.size ?? 25,
    });

    const data = await this.request<{
      events: unknown[];
      pagination: SearchEventsResult["pagination"];
    }>(`/api/events/search${query}`);

    return {
      events: (data.events ?? []).map(normalizeEvent),
      pagination: data.pagination,
    };
  }

  // ── Browse (Location-Aware) ───────────────────────────────────────────────

  /**
   * Browse upcoming events near a location (homepage-style).
   *
   * @example
   * ```ts
   * const nearby = await client.browse({ city: "Atlanta", state: "GA" });
   * ```
   */
  async browse(params: BrowseEventsParams = {}): Promise<BrowseEventsResult> {
    const query = this.qs({
      size: params.size ?? 18,
      context: "homepage",
      recommendation: "upcoming",
      nearLat: params.latitude,
      nearLng: params.longitude,
      preferCity: params.city,
      preferState: params.state,
      categoryEventType: params.categoryEventType,
    });

    const data = await this.request<{
      events: unknown[];
      total: number;
    }>(`/api/events${query}`);

    return {
      events: (data.events ?? []).map(normalizeEvent),
      total: data.total,
    };
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  /**
   * Get available ticket listings for an event.
   *
   * @example
   * ```ts
   * const listings = await client.getListings({ eventId: "abc123" });
   * ```
   */
  async getListings(params: GetListingsParams): Promise<GetListingsResult> {
    const query = this.qs({
      size: params.size ?? 50,
      page: params.page ?? 1,
      order_by_direction: params.orderByDirection ?? "asc",
    });

    const normalizedEventId = normalizeExternalEventId(params.eventId);

    const data = await this.request<{
      success: boolean;
      data: unknown[];
      meta?: Record<string, unknown>;
    }>(`/api/events/${encodeURIComponent(normalizedEventId)}/listings${query}`);

    const listings = (data.data ?? []).map(normalizeListing);

    return {
      listings,
      meta: {
        total: (data.meta?.total as number) ?? listings.length,
        page: (data.meta?.page as number) ?? params.page ?? 1,
        size: (data.meta?.size as number) ?? params.size ?? 50,
        cacheSource: data.meta?.cacheSource as string | undefined,
      },
    };
  }

  // ── Checkout Link ──────────────────────────────────────────────────────────

  /**
   * Create a checkout link for a listing.
   *
   * Returns a URL to the TixBit checkout page where the user can
   * sign in and complete their purchase (card, crypto, etc.).
   *
   * @example
   * ```ts
   * const link = client.createCheckoutLink({
   *   listingId: "P2JO5OBX",
   *   quantity: 2,
   * });
   *
   * console.log(link.url);
   * // → "https://tixbit.com/checkout/process?listing=P2JO5OBX&quantity=2"
   * ```
   */
  createCheckoutLink(params: CheckoutParams): CheckoutLink {
    const quantity = Math.max(1, Math.min(8, Math.round(params.quantity)));
    const url = `${this.baseUrl}/checkout/process?listing=${encodeURIComponent(params.listingId)}&quantity=${quantity}`;

    return {
      url,
      listingId: params.listingId,
      quantity,
    };
  }

  // ── Event URL helper ──────────────────────────────────────────────────────

  /**
   * Build the direct URL to an event page on tixbit.com.
   */
  eventUrl(slugOrId: string): string {
    if (slugOrId.includes("/")) {
      return `${this.baseUrl}/events/${slugOrId}`;
    }

    const normalized = normalizeExternalEventId(slugOrId);
    return `${this.baseUrl}/events/${normalized}`;
  }

  // ── Seatmap ───────────────────────────────────────────────────────────────

  /**
   * Get the seating chart for an event's venue.
   *
   * Returns section-level data including section names, positions, and
   * the venue background image URL. Use this to help users understand
   * where their tickets are located.
   *
   * @example
   * ```ts
   * const seatmap = await client.getSeatmap({ eventId: "4BKJMDZ" });
   * console.log(seatmap.venue_name); // "State Farm Arena"
   * console.log(seatmap.section_names); // ["101", "102", ...]
   * ```
   */
  async getSeatmap(params: GetSeatmapParams): Promise<SeatmapResult> {
    const normalizedEventId = normalizeExternalEventId(params.eventId);

    const data = await this.request<{
      success: boolean;
      event_id: string;
      venue_id: string;
      venue_name: string;
      configuration_id: string;
      configuration_name: string;
      background_image?: string;
      coordinates?: string;
      coordinates_url?: string;
      has_coordinates: boolean;
      capacity?: number;
      venue_data: {
        name: string;
        address?: string;
        city: string;
        region: string;
        country: string;
        time_zone: string;
      };
    }>(`/api/events/${encodeURIComponent(normalizedEventId)}/seating-chart`);

    // Parse coordinates if available
    let zones: SeatmapZone[] = [];
    let sectionNames: string[] = [];

    const coordinatesUrl = data.coordinates_url ?? data.coordinates ?? null;

    if (data.has_coordinates && coordinatesUrl) {
      try {
        zones = await this.fetchAndParseCoordinates(coordinatesUrl);
        sectionNames = zones.flatMap((z) => z.sections.map((s) => s.name));
      } catch {
        // Coordinates fetch failed — return without section data
      }
    }

    return {
      success: data.success,
      event_id: normalizeExternalEventId(data.event_id),
      venue_id: data.venue_id,
      venue_name: data.venue_name,
      configuration_id: data.configuration_id,
      configuration_name: data.configuration_name,
      background_image: toAbsoluteUrl(this.baseUrl, data.background_image ?? null),
      coordinates_url: toAbsoluteUrl(this.baseUrl, coordinatesUrl),
      has_coordinates: data.has_coordinates,
      capacity: data.capacity ?? null,
      venue: data.venue_data,
      zones,
      section_names: sectionNames,
    };
  }

  /**
   * Fetch the coordinates JSON and parse it into zones/sections.
   */
  private async fetchAndParseCoordinates(
    coordinatesUrl: string,
  ): Promise<SeatmapZone[]> {
    // The coordinates URL may be relative (e.g. /api/seatmap/assets?url=...)
    const fullUrl = coordinatesUrl.startsWith("http")
      ? coordinatesUrl
      : `${this.baseUrl}${coordinatesUrl}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(fullUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!res.ok) return [];

      const coords = (await res.json()) as {
        zones?: Array<{
          id: string;
          name: string;
          sections?: Array<{
            id: string;
            name: string;
            labels?: Array<{
              text: string;
              x: number;
              y: number;
              size?: number;
              angle?: number;
            }>;
            shape?: {
              path?: string;
            };
          }>;
        }>;
      };

      if (!coords.zones) return [];

      return coords.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        sections: (zone.sections ?? []).map((section) => {
          const labels = Array.isArray(section.labels)
            ? section.labels
                .filter((label) => label && typeof label.text === "string")
                .map((label) => ({
                  text: label.text,
                  x: typeof label.x === "number" ? label.x : 0,
                  y: typeof label.y === "number" ? label.y : 0,
                  size: typeof label.size === "number" ? label.size : undefined,
                  angle: typeof label.angle === "number" ? label.angle : undefined,
                }))
            : [];

          const primaryLabel =
            labels.find((label) => label.text.toUpperCase() === section.name.toUpperCase()) ??
            labels[0];

          const shapePath =
            section.shape && typeof section.shape.path === "string"
              ? section.shape.path
              : null;

          return {
            id: section.id,
            name: section.name,
            x: primaryLabel?.x ?? 0,
            y: primaryLabel?.y ?? 0,
            labels,
            shape_path: shapePath,
          };
        }),
      }));
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeEvent(raw: unknown): TixBitEvent {
  const e = raw as Record<string, unknown>;

  const rawId =
    str(e.external_event_id) ??
    str(e.externalEventId) ??
    str(e.id) ??
    "";
  const externalEventId = normalizeExternalEventId(rawId);

  return {
    id: externalEventId,
    external_event_id: externalEventId,
    slug: str(e.slug) ?? externalEventId,
    name: str(e.name) ?? str(e.performer) ?? "",
    date: resolveDate(e),
    venue_name: str(e.venue_name) ?? str(e.venueName) ?? null,
    venue_city: str(e.venue_city) ?? str(e.venueCity) ?? null,
    venue_state: str(e.venue_state) ?? str(e.venueState) ?? null,
    image_url: str(e.image_url) ?? str(e.imageUrl) ?? null,
    category_name: str(e.category_name) ?? str(e.categoryName) ?? null,
    category_event_type: str(e.category_event_type) ?? str(e.categoryEventType) ?? null,
    has_listings: Boolean(e.has_listings),
    inventory: normalizeInventory(e.inventory),
  };
}

function normalizeInventory(raw: unknown): TixBitEvent["inventory"] {
  if (!raw || typeof raw !== "object") {
    return { total_available: 0, min_price: 0, max_price: 0 };
  }
  const inv = raw as Record<string, unknown>;
  return {
    total_available: num(inv.total_available) ?? 0,
    min_price: num(inv.min_price) ?? 0,
    max_price: num(inv.max_price) ?? 0,
  };
}

function normalizeListing(raw: unknown): TixBitListing {
  const outer = raw as Record<string, unknown>;
  // The API can return a flat object or { attributes: { ... } } shape
  const attrs = (outer.attributes ?? outer) as Record<string, unknown>;
  return {
    id: str(outer.id) ?? str(attrs.id) ?? "",
    // price_per_ticket is the fee-inclusive per-ticket price (in dollars, not cents)
    price: num(attrs.price_per_ticket) ?? num(attrs.price) ?? 0,
    quantity: num(attrs.quantity) ?? num(attrs.available_quantity) ?? 0,
    quantities_list: Array.isArray(attrs.quantities_list)
      ? (attrs.quantities_list as number[])
      : [],
    section: str(attrs.section) ?? null,
    row: str(attrs.row) ?? null,
    seat_numbers: str(attrs.seat_numbers) ?? null,
    listing_hash: str(attrs.listing_hash) ?? "",
    notes: str(attrs.notes) ?? null,
    delivery_method: str(attrs.delivery_method) ?? str(attrs.delivery_type) ?? null,
    splits: Array.isArray(attrs.splits) ? (attrs.splits as number[]) : [],
    raw: outer as Record<string, unknown>,
  };
}

function resolveDate(e: Record<string, unknown>): string {
  // The API returns dates in various shapes
  if (typeof e.date === "string") return e.date;
  if (typeof e.date === "number") return new Date(e.date).toISOString();
  if (e.date && typeof e.date === "object") {
    const d = e.date as Record<string, string>;
    if (d.month && d.day && d.year) {
      return `${d.month} ${d.day}, ${d.year}`;
    }
  }
  if (typeof e.date_ms === "number") return new Date(e.date_ms).toISOString();
  return "";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error class
// ─────────────────────────────────────────────────────────────────────────────

export class TixBitApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = "TixBitApiError";
  }
}
