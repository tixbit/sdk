// ─────────────────────────────────────────────────────────────────────────────
// @tixbit/sdk — Types
// ─────────────────────────────────────────────────────────────────────────────

/** Configuration for the TixBit client. */
export interface TixBitConfig {
  /**
   * Base URL of the TixBit web app.
   * @default "https://www.tixbit.com"
   */
  baseUrl?: string;

  /**
   * Optional request timeout in milliseconds.
   * @default 15000
   */
  timeoutMs?: number;

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
  /** League abbreviation (for example "NBA" or "MLB"). */
  league?: string;
  /** High-level event type. */
  categoryEventType?: "SPORT" | "CONCERT" | "THEATER" | "ALL";
  /** Public performer ID. */
  performerId?: string;
  /** Public venue ID. */
  venueId?: string;
  /** Parking-event behavior. */
  parkingFilter?: ParkingFilter;
  /** Latitude used with manual location filtering. */
  nearLat?: number;
  /** Longitude used with manual location filtering. */
  nearLng?: number;
  /** Whether location values are inferred, manual, or disabled. */
  locationMode?: LocationMode;
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
  venue_country: string | null;
  image_url: string | null;
  category_slug: string | null;
  category_name: string | null;
  category_event_type: string | null;
  metadata: Record<string, unknown> | null;
  has_listings: boolean;
  inventory: {
    total_available: number;
    min_price: number;
    max_price: number;
    sources?: { local: number; marketplace: number };
  };
}

export interface SearchEventsResult {
  events: TixBitEvent[];
  pagination: {
    page: number;
    size: number;
    total: number | null;
    totalPages: number | null;
    hasNext: boolean;
    hasPrev: boolean;
    totalExact: boolean;
  };
}

/** Public event detail returned by `GET /api/events/:eventId`. */
export interface TixBitEventDetail {
  success: boolean;
  id: string;
  external_id: string;
  slug?: string;
  name?: string;
  url?: string;
  images?: Array<Record<string, unknown> & { url: string }>;
  dates?: Record<string, unknown>;
  sales?: Record<string, unknown>;
  priceRanges?: unknown[];
  classifications?: unknown[];
  info?: string;
  pleaseNote?: string;
  seatmap?: { staticUrl: string };
  _embedded?: { venues?: Array<Record<string, unknown>> };
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
  /** Return all currently available listings. */
  includeAll?: boolean;
  /** Bypass the listings cache for this request. */
  refresh?: boolean;
}

export interface TixBitListing {
  id: string;
  event_id: string | null;
  price: number;
  total_price: number | null;
  base_price_per_ticket: number | null;
  base_total_price: number | null;
  face_value: number | null;
  fee_amount_per_ticket: number | null;
  fee_amount_total: number | null;
  fee_percent: number | null;
  currency: string;
  quantity: number;
  quantities_list: number[];
  section: string | null;
  row: string | null;
  seat_from: string | null;
  seat_to: string | null;
  seat_numbers: string | null;
  /** @deprecated The public API no longer returns listing hashes. */
  listing_hash: string;
  notes: string | null;
  delivery_method: string | null;
  in_hand_date: string | null;
  stock_type: string | null;
  disclosure_ids: string[];
  splits: number[];
  /** Sanitized public response fields not normalized above. */
  raw: Record<string, unknown>;
}

export interface GetListingsResult {
  listings: TixBitListing[];
  meta: {
    total: number;
    page: number;
    size: number;
    totalPages?: number;
    currentPageTotalCount?: number;
    cache?: boolean;
    cacheExpiresAt?: string | null;
    cacheState?: "fresh" | "stale" | "unavailable";
    freshness?: "live" | "cached";
    cacheSource?: string;
  };
}

export interface TixBitListingDisclosure {
  id: string;
  description: string;
  type?: {
    id: string;
    name?: string;
    severity?: string;
    slug?: string;
  };
}

export interface GetListingResult {
  listing: TixBitListing;
  disclosures: TixBitListingDisclosure[];
}

// ── Checkout ────────────────────────────────────────────────────────────────

export interface CheckoutParams {
  /** Listing ID to purchase (from getListings results). */
  listingId: string;
  /** Number of tickets to buy. */
  quantity: number;
}

/** A checkout link that the user opens in a browser to complete purchase. */
export interface CheckoutLink {
  /** Full URL to the checkout page on www.tixbit.com. */
  url: string;
  /** Listing ID being purchased. */
  listingId: string;
  /** Ticket quantity. */
  quantity: number;
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
  /** Page number (1-indexed). @default 1 */
  page?: number;
  /** Optional free-text query. */
  query?: string;
  /** Category slug. */
  category?: string;
  /** League abbreviation. */
  league?: string;
  /** Event date in YYYY-MM-DD format. */
  date?: string;
  /** Category event type: SPORT, CONCERT, THEATER. */
  categoryEventType?: "SPORT" | "CONCERT" | "THEATER" | "ALL";
  /** Response context used by the public browse endpoint. */
  context?: "homepage" | "events" | "category";
  /** Location-selection behavior. */
  locationMode?: LocationMode;
  /** Local-only or broadened search behavior. */
  searchScope?: "local" | "broadened";
  /** Parking-event behavior. */
  parkingFilter?: ParkingFilter;
  /** Upcoming or trending recommendation order. */
  recommendation?: "upcoming" | "trending";
}

export interface BrowseEventsResult {
  events: TixBitEvent[];
  total: number | null;
  totalExact: boolean;
  hasMore: boolean;
  page: number;
  pageSize: number;
  degraded?: boolean;
}

export type ParkingFilter = "exclude" | "only" | "include";
export type LocationMode = "inferred" | "manual" | "none";

// ── Seatmap ─────────────────────────────────────────────────────────────────

export interface GetSeatmapParams {
  /** External event ID (from search results). */
  eventId: string;
}

export interface SeatmapLabel {
  text: string;
  x: number;
  y: number;
  size?: number;
  angle?: number;
}

/** A single section in the venue's seating chart. */
export interface SeatmapSection {
  /** Section ID (e.g. "80841"). */
  id: string;
  /** Human-readable section name (e.g. "101", "FLOOR3", "201"). */
  name: string;
  /**
   * Primary label anchor for simple renderers and relative position helpers.
   */
  x: number;
  y: number;
  /**
   * All labels from the seatmap payload (useful for richer rendering).
   */
  labels: SeatmapLabel[];
  /**
   * SVG path for drawing the section shape overlay.
   */
  shape_path: string | null;
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
