// ─────────────────────────────────────────────────────────────────────────────
// @tixbit/sdk — Types
// ─────────────────────────────────────────────────────────────────────────────

/** Configuration for the TixBit client. */
export interface TixBitConfig {
  /**
   * Base URL of the TixBit web app.
   * @default "https://tixbit.com"
   */
  baseUrl?: string;

  /**
   * Optional request timeout in milliseconds.
   * @default 15000
   */
  timeoutMs?: number;

  /**
   * Optional API key for authenticated endpoints (future use).
   */
  apiKey?: string;
}

// ── Events ──────────────────────────────────────────────────────────────────

export interface SearchEventsParams {
  /** Free-text search query (e.g. "Hawks", "Taylor Swift"). */
  query?: string;
  /** City name (e.g. "Atlanta"). */
  city?: string;
  /** Two-letter US state code (e.g. "GA"). */
  state?: string;
  /** Category slug (e.g. "nba-basketball", "mlb-baseball"). */
  category?: string;
  /** ISO date string — only events on or after this date. */
  startDate?: string;
  /** ISO date string — only events on or before this date. */
  endDate?: string;
  /** Page number (1-indexed). @default 1 */
  page?: number;
  /** Page size. @default 25 */
  size?: number;
}

export interface TixBitEvent {
  id: string;
  external_event_id: string;
  slug: string;
  name: string;
  date: string;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  image_url: string | null;
  category_name: string | null;
  category_event_type: string | null;
  has_listings: boolean;
  inventory: {
    total_available: number;
    min_price: number;
    max_price: number;
  };
}

export interface SearchEventsResult {
  events: TixBitEvent[];
  pagination: {
    page: number;
    size: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ── Listings ────────────────────────────────────────────────────────────────

export interface GetListingsParams {
  /** External event ID (from search results). */
  eventId: string;
  /** Page size. @default 50 */
  size?: number;
  /** Page number. @default 1 */
  page?: number;
  /** Sort direction for price. @default "asc" */
  orderByDirection?: "asc" | "desc";
}

export interface TixBitListing {
  id: string;
  price: number;
  quantity: number;
  quantities_list: number[];
  section: string | null;
  row: string | null;
  seat_numbers: string | null;
  listing_hash: string;
  notes: string | null;
  delivery_method: string | null;
  splits: number[];
  raw: Record<string, unknown>;
}

export interface GetListingsResult {
  listings: TixBitListing[];
  meta: {
    total: number;
    page: number;
    size: number;
    cacheSource?: string;
  };
}

// ── Purchase ────────────────────────────────────────────────────────────────

export interface PurchaseParams {
  /** The listing ID to purchase. */
  listingId: string;
  /** Number of tickets. */
  quantity: number;
  /** Buyer's full name. */
  buyerName: string;
  /** Buyer's email address. */
  buyerEmail: string;
  /** Buyer's phone number (optional). */
  buyerPhone?: string;
}

export interface PurchaseResult {
  success: boolean;
  purchaseId: string | null;
  orderToken: string | null;
  status: string;
  totalCents: number;
  raw: Record<string, unknown>;
}

// ── Homepage / Browse ───────────────────────────────────────────────────────

export interface BrowseEventsParams {
  /** User latitude for location-aware results. */
  latitude?: number;
  /** User longitude for location-aware results. */
  longitude?: number;
  /** Preferred city. */
  city?: string;
  /** Preferred state. */
  state?: string;
  /** Number of results. @default 18 */
  size?: number;
  /** Category event type: SPORT, CONCERT, THEATER. */
  categoryEventType?: "SPORT" | "CONCERT" | "THEATER" | "ALL";
}

export interface BrowseEventsResult {
  events: TixBitEvent[];
  total: number;
}

// ── Seatmap ─────────────────────────────────────────────────────────────────

export interface GetSeatmapParams {
  /** External event ID (from search results). */
  eventId: string;
}

/** A single section in the venue's seating chart. */
export interface SeatmapSection {
  /** Section ID (e.g. "80841"). */
  id: string;
  /** Human-readable section name (e.g. "101", "FLOOR3", "201"). */
  name: string;
  /**
   * Center coordinates of the section label on the map.
   * Useful for understanding relative position.
   */
  x: number;
  y: number;
}

/** A zone grouping sections (e.g. "Section", "Floor", "Suite"). */
export interface SeatmapZone {
  id: string;
  name: string;
  sections: SeatmapSection[];
}

/** Venue metadata returned with the seatmap. */
export interface SeatmapVenue {
  name: string;
  address?: string;
  city: string;
  region: string;
  country: string;
  time_zone: string;
}

/** Result from the seating chart API. */
export interface SeatmapResult {
  success: boolean;
  event_id: string;
  venue_id: string;
  venue_name: string;
  configuration_id: string;
  configuration_name: string;
  /** URL to the background SVG image of the venue map. */
  background_image: string | null;
  /** URL to the coordinates JSON (section polygons). */
  coordinates_url: string | null;
  has_coordinates: boolean;
  capacity: number | null;
  venue: SeatmapVenue;
  /** Parsed section data from coordinates (when available). */
  zones: SeatmapZone[];
  /** All section names for quick reference. */
  section_names: string[];
}
