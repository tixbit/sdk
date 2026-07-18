// ─────────────────────────────────────────────────────────────────────────────
// @tixbit/sdk — Client
//
// Standalone HTTP client for the TixBit public API. Zero internal dependencies.
// Works from the Node.js versions declared in package.json.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  TixBitConfig,
  SearchEventsParams,
  SearchEventsResult,
  TixBitEvent,
  TixBitEventDetail,
  GetListingsParams,
  GetListingsResult,
  GetListingResult,
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

const DEFAULT_BASE_URL = "https://www.tixbit.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = "@tixbit/sdk";

function normalizeExternalEventId(eventId: string): string {
  if (!eventId) return eventId;

  const trimmed = eventId.trim();
  const providerPrefixedId = trimmed.match(/^([a-z]{5,})-([A-Z0-9]{6,})$/i);
  if (providerPrefixedId?.[2]) {
    return providerPrefixedId[2].toUpperCase();
  }

  if (/^[A-Z0-9]{6,}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
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

  constructor(config: TixBitConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };

    try {
      const res = await fetch(url, {
        headers,
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
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TixBitTimeoutError(url, this.timeoutMs);
      }
      throw error;
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
      league: params.league,
      categoryEventType: params.categoryEventType,
      performerId: params.performerId,
      venueId: params.venueId,
      parkingFilter: params.parkingFilter,
      nearLat: params.nearLat,
      nearLng: params.nearLng,
      locationMode: params.locationMode,
      startDate: params.startDate,
      endDate: params.endDate,
      page: params.page,
      size: params.size ?? 25,
    });

    const data = await this.request<{
      events: unknown[];
      pagination: SearchEventsResult["pagination"];
    }>(`/api/events/search${query}`);

    const pagination = data.pagination;

    return {
      events: (data.events ?? []).map(normalizeEvent),
      pagination: {
        ...pagination,
        totalExact: pagination.totalExact ?? pagination.total !== null,
      },
    };
  }

  /** Get one public event by ID or slug. */
  async getEvent(eventId: string): Promise<TixBitEventDetail> {
    const normalizedEventId = normalizeExternalEventId(eventId);
    const data = await this.request<TixBitEventDetail>(
      `/api/events/${encodeURIComponent(normalizedEventId)}`,
    );
    const publicEventId = normalizeExternalEventId(data.external_id ?? data.id);

    return {
      ...data,
      id: publicEventId,
      external_id: publicEventId,
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
      page: params.page ?? 1,
      size: params.size ?? 18,
      query: params.query,
      category: params.category,
      league: params.league,
      date: params.date,
      context: params.context ?? "homepage",
      recommendation: params.recommendation ?? "upcoming",
      nearLat: params.latitude,
      nearLng: params.longitude,
      preferCity: params.city,
      preferState: params.state,
      categoryEventType: params.categoryEventType,
      locationMode: params.locationMode,
      searchScope: params.searchScope,
      parkingFilter: params.parkingFilter,
    });

    const data = await this.request<{
      events: unknown[];
      total: number | null;
      totalExact?: boolean;
      hasMore?: boolean;
      page?: number;
      pageSize?: number;
      degraded?: boolean;
    }>(`/api/events${query}`);

    return {
      events: (data.events ?? []).map(normalizeEvent),
      total: data.total,
      totalExact: data.totalExact ?? data.total !== null,
      hasMore: data.hasMore ?? false,
      page: data.page ?? params.page ?? 1,
      pageSize: data.pageSize ?? params.size ?? 18,
      ...(data.degraded === undefined ? {} : { degraded: data.degraded }),
    };
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  /**
   * Get available ticket listings for an event.
   *
   * @example
   * ```ts
   * const listings = await client.getListings({ eventId: "EVENT123" });
   * ```
   */
  async getListings(params: GetListingsParams): Promise<GetListingsResult> {
    const query = this.qs({
      size: params.size ?? 50,
      page: params.page ?? 1,
      order_by_direction: params.orderByDirection ?? "asc",
      includeAll: params.includeAll,
      refresh: params.refresh,
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
        total: readListingMetaNumber(data.meta, "total_count", "total") ?? listings.length,
        page: readListingMetaNumber(data.meta, "current_page_number", "page") ?? params.page ?? 1,
        size: readListingMetaNumber(data.meta, "current_page_size", "size") ?? params.size ?? 50,
        totalPages: readListingMetaNumber(data.meta, "total_pages") ?? undefined,
        currentPageTotalCount:
          readListingMetaNumber(data.meta, "current_page_total_count") ?? undefined,
        cache: readBoolean(data.meta?.cache) ?? undefined,
        cacheExpiresAt: readNullableString(data.meta?.cache_expires_at),
        cacheState: readEnum(data.meta?.cache_state, ["fresh", "stale", "unavailable"]),
        freshness: readEnum(data.meta?.freshness, ["live", "cached"]),
        cacheSource: data.meta?.cacheSource as string | undefined,
      },
    };
  }

  /** Get one public listing by listing ID. */
  async getListing(listingId: string): Promise<GetListingResult> {
    const data = await this.request<{
      success: boolean;
      listing: unknown;
      disclosures?: GetListingResult["disclosures"];
    }>(`/api/listings/${encodeURIComponent(listingId)}`);

    return {
      listing: normalizeListing(data.listing),
      disclosures: data.disclosures ?? [],
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
   *   listingId: "LISTING123",
   *   quantity: 2,
   * });
   *
   * console.log(link.url);
   * // → "https://www.tixbit.com/checkout/process?listing=LISTING123&quantity=2"
   * ```
   */
  createCheckoutLink(params: CheckoutParams): CheckoutLink {
    const listingId = params.listingId.trim();
    if (!/^[A-Za-z0-9_-]{2,50}$/.test(listingId)) {
      throw new TypeError(
        "listingId must be 2-50 letters, numbers, hyphens, or underscores",
      );
    }
    if (!Number.isInteger(params.quantity) || params.quantity < 1 || params.quantity > 8) {
      throw new RangeError("quantity must be an integer from 1 to 8");
    }
    const url = `${this.baseUrl}/checkout/process?listing=${encodeURIComponent(listingId)}&quantity=${params.quantity}`;

    return {
      url,
      listingId,
      quantity: params.quantity,
    };
  }

  // ── Event URL helper ──────────────────────────────────────────────────────

  /**
   * Build the direct URL to an event page on www.tixbit.com.
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
   * const seatmap = await client.getSeatmap({ eventId: "EVENT123" });
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
    venue_country: str(e.venue_country) ?? str(e.venueCountry) ?? null,
    image_url: str(e.image_url) ?? str(e.imageUrl) ?? null,
    category_slug: str(e.category_slug) ?? str(e.categorySlug) ?? null,
    category_name: str(e.category_name) ?? str(e.categoryName) ?? null,
    category_event_type: str(e.category_event_type) ?? str(e.categoryEventType) ?? null,
    metadata:
      e.metadata && typeof e.metadata === "object"
        ? (e.metadata as Record<string, unknown>)
        : null,
    has_listings: Boolean(e.has_listings),
    inventory: normalizeInventory(e.inventory),
  };
}

function normalizeInventory(raw: unknown): TixBitEvent["inventory"] {
  if (!raw || typeof raw !== "object") {
    return { total_available: 0, min_price: 0, max_price: 0 };
  }
  const inv = raw as Record<string, unknown>;
  const sources = inv.sources as Record<string, unknown> | undefined;
  return {
    total_available: num(inv.total_available) ?? 0,
    min_price: num(inv.min_price) ?? 0,
    max_price: num(inv.max_price) ?? 0,
    ...(sources
      ? {
          sources: {
            local: num(sources.local) ?? 0,
            marketplace: num(sources.marketplace) ?? 0,
          },
        }
      : {}),
  };
}

function normalizeListing(raw: unknown): TixBitListing {
  const outer = raw as Record<string, unknown>;
  // The API can return a flat object or { attributes: { ... } } shape
  const attrs = (outer.attributes ?? outer) as Record<string, unknown>;
  return {
    id: str(outer.id) ?? str(attrs.id) ?? "",
    event_id: str(attrs.event_id) ?? null,
    // price_per_ticket is the fee-inclusive per-ticket price (in dollars, not cents)
    price: num(attrs.price_per_ticket) ?? num(attrs.price) ?? 0,
    total_price: num(attrs.total_price),
    base_price_per_ticket: num(attrs.base_price_per_ticket),
    base_total_price: num(attrs.base_total_price),
    face_value: num(attrs.face_value),
    fee_amount_per_ticket: num(attrs.fee_amount_per_ticket),
    fee_amount_total: num(attrs.fee_amount_total),
    fee_percent: num(attrs.fee_percent),
    currency: str(attrs.currency) ?? "USD",
    quantity: num(attrs.quantity) ?? num(attrs.available_quantity) ?? 0,
    quantities_list: Array.isArray(attrs.quantities_list)
      ? (attrs.quantities_list as number[])
      : [],
    section: str(attrs.section) ?? null,
    row: str(attrs.row) ?? null,
    seat_from: str(attrs.seat_from) ?? null,
    seat_to: str(attrs.seat_to) ?? null,
    seat_numbers: str(attrs.seat_numbers) ?? null,
    listing_hash: str(attrs.listing_hash) ?? "",
    notes: str(attrs.notes) ?? null,
    delivery_method: str(attrs.delivery_method) ?? str(attrs.delivery_type) ?? null,
    in_hand_date: str(attrs.in_hand_date) ?? null,
    stock_type: str(attrs.stock_type) ?? null,
    disclosure_ids: Array.isArray(attrs.disclosure_ids)
      ? attrs.disclosure_ids.filter((id): id is string => typeof id === "string")
      : [],
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

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined;
}

function readEnum<const T extends string>(
  value: unknown,
  choices: readonly T[],
): T | undefined {
  return typeof value === "string" && choices.includes(value as T)
    ? (value as T)
    : undefined;
}

function readListingMetaNumber(
  meta: Record<string, unknown> | undefined,
  ...keys: string[]
): number | null {
  if (!meta) return null;

  for (const key of keys) {
    const value = num(meta[key]);
    if (value !== null) return value;
  }

  return null;
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

export class TixBitTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`Request timed out after ${timeoutMs}ms: ${url}`);
    this.name = "TixBitTimeoutError";
  }
}
