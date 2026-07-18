// ─────────────────────────────────────────────────────────────────────────────
// @tixbit/sdk CLI
//
// Usage:
//   tixbit search "Hawks" --state GA
//   tixbit browse --city Atlanta --state GA
//   tixbit listings <eventId>
//   tixbit url <slug>
//
// Output: JSON (for piping to agents) or human-readable tables.
// Set TIXBIT_BASE_URL to override the default (https://www.tixbit.com).
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from "commander";
import { createRequire } from "node:module";
import { TixBitClient } from "./client.js";
import type {
  SearchEventsParams,
  BrowseEventsParams,
  GetListingsParams,
  TixBitEvent,
  TixBitListing,
  SeatmapResult,
  SeatmapSection,
} from "./types.js";

const client = new TixBitClient({
  baseUrl: process.env.TIXBIT_BASE_URL,
});
const packageJson = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

// ── Output helpers ──────────────────────────────────────────────────────────

function output(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  // Human-readable output
  if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatItem(item) + "\n");
    }
    return;
  }

  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function formatItem(item: unknown): string {
  if (!item || typeof item !== "object") return String(item);

  const e = item as Record<string, unknown>;

  // Event format
  if (e.name && e.external_event_id) {
    const parts = [
      `  ${e.name}`,
      `  ID: ${e.external_event_id}`,
    ];
    if (e.date) parts.push(`  Date: ${e.date}`);
    const location = [e.venue_city, e.venue_state].filter(Boolean).join(", ");
    if (location) parts.push(`  Location: ${location}`);
    if (e.venue_name) parts.push(`  Venue: ${e.venue_name}`);
    if (e.has_listings) {
      const inv = e.inventory as Record<string, number> | undefined;
      if (inv?.min_price) {
        parts.push(`  From: $${inv.min_price.toFixed(2)} (${inv.total_available} available)`);
      }
    }
    return parts.join("\n") + "\n";
  }

  // Listing format
  if (e.listing_hash !== undefined) {
    const parts = [
      `  $${(e.price as number).toFixed(2)} × ${e.quantity} ticket(s)`,
      `  ID: ${e.id}`,
    ];
    if (e.section) parts.push(`  Section: ${e.section}${e.row ? ` Row ${e.row}` : ""}`);
    if (e.delivery_method) parts.push(`  Delivery: ${e.delivery_method}`);
    if ((e.quantities_list as number[])?.length > 0) {
      parts.push(`  Qty options: ${(e.quantities_list as number[]).join(", ")}`);
    }
    return parts.join("\n") + "\n";
  }

  return JSON.stringify(item, null, 2);
}

function handleError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const program = new Command()
  .name("tixbit")
  .description("Search events, browse listings, and get TixBit checkout links")
  .version(packageJson.version);

// ── search ──────────────────────────────────────────────────────────────────

program
  .command("search [query]")
  .description("Search for events by keyword, city, state, or category")
  .option("--city <city>", "Filter by city")
  .option("--state <state>", "Filter by state (2-letter code)")
  .option("--category <slug>", "Filter by category slug (e.g. nba-basketball)")
  .option("--league <league>", "Filter by league abbreviation (e.g. NBA)")
  .option("--event-type <type>", "SPORT, CONCERT, THEATER, or ALL")
  .option("--performer-id <id>", "Filter by public performer ID")
  .option("--venue-id <id>", "Filter by public venue ID")
  .option("--parking <mode>", "Parking filter: exclude, only, or include")
  .option("--near-lat <lat>", "Latitude for manual location filtering")
  .option("--near-lng <lng>", "Longitude for manual location filtering")
  .option("--location-mode <mode>", "Location mode: inferred, manual, or none")
  .option("--start-date <date>", "Events on or after this date (ISO)")
  .option("--end-date <date>", "Events on or before this date (ISO)")
  .option("--page <n>", "Page number", "1")
  .option("--size <n>", "Results per page", "10")
  .option("--json", "Output raw JSON (for agents)", false)
  .action(async (query: string | undefined, opts: {
    city?: string;
    state?: string;
    category?: string;
    league?: string;
    eventType?: SearchEventsParams["categoryEventType"];
    performerId?: string;
    venueId?: string;
    parking?: SearchEventsParams["parkingFilter"];
    nearLat?: string;
    nearLng?: string;
    locationMode?: SearchEventsParams["locationMode"];
    startDate?: string;
    endDate?: string;
    page: string;
    size: string;
    json: boolean;
  }) => {
    try {
      const params: SearchEventsParams = {
        query,
        city: opts.city,
        state: opts.state,
        category: opts.category,
        league: opts.league,
        categoryEventType: opts.eventType,
        performerId: opts.performerId,
        venueId: opts.venueId,
        parkingFilter: opts.parking,
        nearLat: opts.nearLat ? parseFloat(opts.nearLat) : undefined,
        nearLng: opts.nearLng ? parseFloat(opts.nearLng) : undefined,
        locationMode: opts.locationMode,
        startDate: opts.startDate,
        endDate: opts.endDate,
        page: parseInt(opts.page, 10),
        size: parseInt(opts.size, 10),
      };

      const result = await client.searchEvents(params);
      const isJson = opts.json;

      if (isJson) {
        output(result, true);
      } else {
        const { pagination } = result;
        process.stdout.write(
          `\nFound ${pagination.total} event(s) — page ${pagination.page}/${pagination.totalPages}\n\n`,
        );
        output(result.events, false);
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── browse ──────────────────────────────────────────────────────────────────

program
  .command("browse")
  .description("Browse upcoming events near a location")
  .option("--city <city>", "Preferred city")
  .option("--state <state>", "Preferred state (2-letter code)")
  .option("--lat <lat>", "Latitude")
  .option("--lng <lng>", "Longitude")
  .option("--category <type>", "SPORT, CONCERT, THEATER, or ALL", "ALL")
  .option("--category-slug <slug>", "Filter by category slug")
  .option("--query <query>", "Filter by search query")
  .option("--league <league>", "Filter by league abbreviation")
  .option("--date <date>", "Filter by event date (YYYY-MM-DD)")
  .option("--page <n>", "Page number", "1")
  .option("--context <context>", "homepage, events, or category", "homepage")
  .option("--recommendation <kind>", "upcoming or trending", "upcoming")
  .option("--parking <mode>", "Parking filter: exclude, only, or include")
  .option("--location-mode <mode>", "Location mode: inferred, manual, or none")
  .option("--size <n>", "Number of results", "10")
  .option("--json", "Output raw JSON (for agents)", false)
  .action(async (opts: {
    city?: string;
    state?: string;
    lat?: string;
    lng?: string;
    category: BrowseEventsParams["categoryEventType"];
    categorySlug?: string;
    query?: string;
    league?: string;
    date?: string;
    page: string;
    context: BrowseEventsParams["context"];
    recommendation: BrowseEventsParams["recommendation"];
    parking?: BrowseEventsParams["parkingFilter"];
    locationMode?: BrowseEventsParams["locationMode"];
    size: string;
    json: boolean;
  }) => {
    try {
      const params: BrowseEventsParams = {
        city: opts.city,
        state: opts.state,
        latitude: opts.lat ? parseFloat(opts.lat) : undefined,
        longitude: opts.lng ? parseFloat(opts.lng) : undefined,
        categoryEventType: opts.category ?? "ALL",
        category: opts.categorySlug,
        query: opts.query,
        league: opts.league,
        date: opts.date,
        page: parseInt(opts.page, 10),
        context: opts.context,
        recommendation: opts.recommendation,
        parkingFilter: opts.parking,
        locationMode: opts.locationMode,
        size: parseInt(opts.size, 10),
      };

      const result = await client.browse(params);
      const isJson = opts.json;

      if (isJson) {
        output(result, true);
      } else {
        process.stdout.write(
          `\n${result.events.length} upcoming event(s) near ${opts.city ?? "you"}\n\n`,
        );
        output(result.events, false);
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── listings ────────────────────────────────────────────────────────────────

program
  .command("listings <eventId>")
  .description("Get available ticket listings for an event")
  .option("--size <n>", "Results per page", "20")
  .option("--page <n>", "Page number", "1")
  .option("--sort <dir>", "Price sort: asc or desc", "asc")
  .option("--all", "Return all available listings", false)
  .option("--refresh", "Bypass the listings cache", false)
  .option("--json", "Output raw JSON (for agents)", false)
  .action(async (eventId: string, opts: {
    size: string;
    page: string;
    sort: "asc" | "desc";
    all: boolean;
    refresh: boolean;
    json: boolean;
  }) => {
    try {
      const params: GetListingsParams = {
        eventId,
        size: parseInt(opts.size, 10),
        page: parseInt(opts.page, 10),
        orderByDirection: opts.sort,
        includeAll: opts.all,
        refresh: opts.refresh,
      };

      const result = await client.getListings(params);
      const isJson = opts.json;

      if (isJson) {
        output(result, true);
      } else {
        process.stdout.write(
          `\n${result.listings.length} listing(s) for event ${eventId}\n\n`,
        );
        output(result.listings, false);
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── checkout ────────────────────────────────────────────────────────────────

program
  .command("checkout <listingId>")
  .description("Get a checkout link to buy tickets for a listing")
  .requiredOption("--quantity <n>", "Number of tickets to buy")
  .option("--json", "Output raw JSON", false)
  .action(async (listingId: string, opts: { quantity: string; json?: boolean }) => {
    try {
      const quantity = Number(opts.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 8) {
        process.stderr.write("Error: --quantity must be an integer from 1 to 8\n");
        process.exit(1);
      }

      const isJson = opts.json === true;

      // Fetch listing details to show context
      let listingInfo: TixBitListing | undefined;
      try {
        listingInfo = (await client.getListing(listingId)).listing;
      } catch {
        // Listing fetch failed — not critical, we can still generate the link
      }

      const link = client.createCheckoutLink({ listingId, quantity });

      if (isJson) {
        output({ ...link, listing: listingInfo ?? null }, true);
        return;
      }

      process.stdout.write("\n🎟  Checkout Link\n\n");

      if (listingInfo) {
        process.stdout.write(`   Listing: ${listingInfo.id}\n`);
        if (listingInfo.section) {
          process.stdout.write(
            `   Section: ${listingInfo.section}${listingInfo.row ? ` Row ${listingInfo.row}` : ""}\n`,
          );
        }
        process.stdout.write(
          `   Price: $${listingInfo.price.toFixed(2)} × ${quantity} = $${(listingInfo.price * quantity).toFixed(2)}\n`,
        );
      }

      process.stdout.write(`   Quantity: ${quantity}\n\n`);
      process.stdout.write(`   ${link.url}\n\n`);
      process.stdout.write(
        "   Open the link above in your browser to complete checkout.\n\n",
      );
    } catch (err) {
      handleError(err);
    }
  });

// ── seatmap ─────────────────────────────────────────────────────────────────

program
  .command("seatmap <eventId>")
  .description("Show the seating chart / section map for an event's venue")
  .option("--section <name>", "Highlight a specific section (case-insensitive)")
  .option("--json", "Output raw JSON (for agents)", false)
  .action(async (eventId: string, opts: { section?: string; json: boolean }) => {
    try {
      const result = await client.getSeatmap({ eventId });
      const isJson = opts.json;

      if (isJson) {
        output(result, true);
        return;
      }

      if (!result.success) {
        process.stderr.write("Seatmap not available for this event.\n");
        process.exit(1);
      }

      // Header
      process.stdout.write(`\n🏟  ${result.venue_name}\n`);
      process.stdout.write(`   ${result.configuration_name}\n`);
      if (result.venue.address) {
        process.stdout.write(`   ${result.venue.address}, ${result.venue.city}, ${result.venue.region}\n`);
      }
      if (result.capacity) {
        process.stdout.write(`   Capacity: ${result.capacity.toLocaleString()}\n`);
      }
      process.stdout.write("\n");

      if (!result.has_coordinates || result.zones.length === 0) {
        process.stdout.write("  No section-level seating data available for this venue.\n\n");
        return;
      }

      // Group sections by level (100s, 200s, Floor, Suites, Loge, etc.)
      const groups = categorizeSections(result.zones.flatMap((z) => z.sections));
      const highlightSection = opts.section?.toUpperCase();

      for (const [groupName, sections] of Object.entries(groups)) {
        process.stdout.write(`  ── ${groupName} ──\n`);

        // Show sections in rows of up to 8
        const names = sections.map((s) => s.name);
        for (let i = 0; i < names.length; i += 8) {
          const row = names.slice(i, i + 8);
          const formatted = row
            .map((name) => {
              if (highlightSection && name.toUpperCase() === highlightSection) {
                return ` ▸${name}◂ `;
              }
              return ` ${name} `;
            })
            .join("  ");
          process.stdout.write(`    ${formatted}\n`);
        }
        process.stdout.write("\n");
      }

      // If a section was requested, show its location
      if (highlightSection) {
        const allSections = result.zones.flatMap((z) => z.sections);
        const match = allSections.find(
          (s) => s.name.toUpperCase() === highlightSection,
        );
        if (match) {
          const pos = describePosition(match, allSections);
          process.stdout.write(`  📍 Section ${match.name}: ${pos}\n\n`);
        } else {
          process.stdout.write(`  ⚠  Section "${opts.section}" not found in this venue.\n`);
          process.stdout.write(`     Available: ${result.section_names.slice(0, 20).join(", ")}${result.section_names.length > 20 ? "..." : ""}\n\n`);
        }
      }

      process.stdout.write(
        `  Total sections: ${result.section_names.length}\n\n`,
      );
    } catch (err) {
      handleError(err);
    }
  });

// ── url ─────────────────────────────────────────────────────────────────────

program
  .command("url <slug>")
  .description("Print the TixBit event page URL for a slug or ID")
  .action((slug: string) => {
    process.stdout.write(client.eventUrl(slug) + "\n");
  });

// ── Seatmap helpers ─────────────────────────────────────────────────────────

/**
 * Categorize sections into display groups based on naming conventions.
 *
 * Typical venue sections follow patterns:
 *   100-199: Lower Level
 *   200-299: Upper Level / Club Level
 *   FLOOR1-9: Floor sections
 *   L1-L18: Loge sections
 *   S1-S4: Sky sections
 *   T1-T26: Terrace sections
 *   V1-V20: Vista sections
 *   SUITES: Suite sections
 *   STANDING/UPPER: Standing room
 */
function categorizeSections(
  sections: SeatmapSection[],
): Record<string, SeatmapSection[]> {
  const groups: Record<string, SeatmapSection[]> = {};

  const addToGroup = (groupName: string, section: SeatmapSection) => {
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(section);
  };

  // Detect if venue uses small numbers for field level (baseball/football stadiums)
  // vs. 100-level numbering (basketball/hockey arenas)
  const hasLowerLevel = sections.some((s) => /^1\d{2}/.test(s.name));
  const hasSmallNumbers = sections.some((s) => /^\d{1,2}$/.test(s.name));

  for (const section of sections) {
    const name = section.name.toUpperCase();

    if (/^FLOOR\d/.test(name) || /^FLR\d/.test(name)) {
      addToGroup("🏀 Floor", section);
    } else if (/^1\d{2}/.test(name)) {
      addToGroup("⬇ Lower Level (100s)", section);
    } else if (/^2\d{2}/.test(name)) {
      addToGroup("⬆ Upper Level (200s)", section);
    } else if (/^3\d{2}/.test(name)) {
      addToGroup("🔵 300 Level", section);
    } else if (/^4\d{2}/.test(name)) {
      addToGroup("🟣 400 Level", section);
    } else if (/^\d{1,2}$/.test(name) && hasSmallNumbers) {
      addToGroup(hasLowerLevel ? "🏟  Field Level" : "⬇ Lower Level", section);
    } else if (/^L\d/.test(name)) {
      addToGroup("🪵 Loge", section);
    } else if (/^S\d/.test(name)) {
      addToGroup("☁ Sky", section);
    } else if (/^T\d/.test(name)) {
      addToGroup("🌇 Terrace", section);
    } else if (/^V\d/.test(name)) {
      addToGroup("👀 Vista", section);
    } else if (/^STE/.test(name)) {
      addToGroup("🏢 Suites", section);
    } else if (name.includes("SUITE") || name.includes("SUITES")) {
      addToGroup("🏢 Suites", section);
    } else if (name.includes("STANDING") || name === "SRO" || name === "UPPER") {
      addToGroup("🧍 Standing Room", section);
    } else if (name === "DECK" || name === "ROOF" || name === "GA" || name === "HAT") {
      addToGroup("🎪 General / Special", section);
    } else {
      addToGroup("📍 Other", section);
    }
  }

  return groups;
}

/**
 * Describe a section's relative position in human-readable terms.
 * Uses the section's label coordinates relative to the venue's center.
 */
function describePosition(
  section: SeatmapSection,
  allSections: SeatmapSection[],
): string {
  if (!allSections.length) return "position unknown";

  // Find the center of all sections
  const centerX =
    allSections.reduce((sum, s) => sum + s.x, 0) / allSections.length;
  const centerY =
    allSections.reduce((sum, s) => sum + s.y, 0) / allSections.length;

  // Determine relative position
  const dx = section.x - centerX;
  const dy = section.y - centerY;

  // Use compass-style directions (note: SVG y-axis is inverted)
  const horizontal =
    Math.abs(dx) < 50 ? "center" : dx < 0 ? "left side" : "right side";
  const vertical =
    Math.abs(dy) < 50
      ? "center"
      : dy < 0
        ? "near side (closer to stage/court)"
        : "far side";

  if (horizontal === "center" && vertical === "center") {
    return "center of venue";
  }

  return [vertical, horizontal].filter((p) => p !== "center").join(", ");
}

// ── Parse ───────────────────────────────────────────────────────────────────

program.parse();
