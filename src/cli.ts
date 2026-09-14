// ─────────────────────────────────────────────────────────────────────────────
// @tixbit/sdk CLI
//
// Usage:
//   tixbit search "Hawks" --state GA
//   tixbit browse --city Atlanta --state GA
//   tixbit listings <eventId>
//   tixbit purchase <listingId> --quantity 2 --email buyer@example.com
//   tixbit url <slug>
//
// Output: JSON for both success and error results.
// Set TIXBIT_BASE_URL to override the default (https://www.tixbit.com).
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from "commander";
import { assertMppChallenge, positiveInteger, redact, usdCents } from "./safety.js";
import { createRequire } from "node:module";
import { normalizePurchaseTicketsParams, TixBitClient } from "./client.js";
import type {
  SearchEventsParams,
  BrowseEventsParams,
  GetListingsParams,
  TixBitEvent,
  TixBitListing,
  SeatmapResult,
  SeatmapSection,
  PurchaseTicketsResult,
} from "./types.js";

const client = (() => {
  try { return new TixBitClient({ baseUrl: process.env.TIXBIT_BASE_URL }); }
  catch (error) { return handleError(error); }
})();
const packageJson = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

// ── Output helpers ──────────────────────────────────────────────────────────

function output(data: unknown, json: boolean): void {
  data = redact(data, [process.env.TIXBIT_LINK_TOKEN ?? "", process.env.TIXBIT_ACCESS_TOKEN ?? "", process.env.MPPX_PRIVATE_KEY ?? ""]);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    data = { success: true, ...data };
    if ((data as { success?: boolean }).success === false) process.exitCode = 2;
  }
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

function outputPurchaseResult(result: PurchaseTicketsResult): void {
  if (result.success && result.order) {
    process.stdout.write(
      `\nPurchase complete\n\n` +
        `  Order: ${result.orderReference}\n` +
        `  Tickets: ${result.order.quantity}\n` +
        `  Total: ${result.order.currency} ${result.order.total.toFixed(2)}\n` +
        (result.receiptUrl ? `  Receipt: ${result.receiptUrl}\n` : "") +
        "\n",
    );
    return;
  }

  process.stdout.write(
    `\nPurchase ${result.status}\n\n` +
      `  Order: ${result.orderReference ?? "not assigned"}\n` +
      `  Action: ${result.action ?? "Review the JSON result before retrying."}\n\n`,
  );
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
  const msg = err instanceof TypeError || err instanceof RangeError ? err.message : "Request failed. Check input and service availability; do not retry an uncertain write.";
  output({ success: false, error: { code: "COMMAND_FAILED", message: msg } }, true);
  process.exit(1);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const program = new Command()
  .name("tixbit")
  .description("Search events, browse listings, and buy TixBit tickets")
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
  .option("--json", "Output raw JSON (for agents)", true)
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
  .option("--json", "Output raw JSON (for agents)", true)
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
  .option("--json", "Output raw JSON (for agents)", true)
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

// ── Agent additions ─────────────────────────────────────────────────────────

program.command("quote <eventId>")
  .description("Get refreshed live listings; not a reservation or offer")
  .option("--page <n>", "Page number", "1")
  .option("--size <n>", "Page size (max 100)", "100")
  .option("--json", "Output JSON", true)
  .action(async (eventId: string, opts: { page: string; size: string }) => {
    try {
      output(await client.quoteListings({ eventId, page: positiveInteger(opts.page, "--page", 10000), size: positiveInteger(opts.size, "--size", 100) }), true);
    } catch (error) { handleError(error); }
  });

program.command("auth")
  .description("Show public browser sign-in and wallet setup; does not create a CLI session")
  .option("--json", "Output JSON", true)
  .action(() => output(client.getAuthorizationInfo(), true));

program.command("buy <listingId>")
  .description("Quote or confirm Stripe Link checkout (4-12 alphanumeric listing IDs only)")
  .requiredOption("--quantity <n>", "Number of tickets (1-8)")
  .requiredOption("--max-price <total>", "Maximum TOTAL USD charge including fees")
  .option("--email <email>", "Buyer delivery email (or TIXBIT_EMAIL)")
  .option("--confirm", "Approve payment; return browser handoff if wallet authorization is missing", false)
  .option("--json", "Output JSON", true)
  .action(async (listingId: string, opts: { quantity: string; maxPrice: string; confirm: boolean; email?: string }) => {
    try {
      output(await client.buyTickets({ listingId, quantity: positiveInteger(opts.quantity, "--quantity", 8), maxAmountCents: usdCents(opts.maxPrice), email: opts.email ?? process.env.TIXBIT_EMAIL ?? "", confirm: opts.confirm, sharedPaymentToken: process.env.TIXBIT_LINK_TOKEN }), true);
    } catch (error) { handleError(error); }
  });

const sell = program.command("sell").description("Seller browser sign-in or optional authorized user integration");
sell.command("list").option("--json", "Output JSON", true)
  .action(async () => {
    try { output(await client.listSellerListings(process.env.TIXBIT_ACCESS_TOKEN ?? ""), true); }
    catch (error) { handleError(error); }
  });
sell.command("create").option("--confirm", "Approve listing creation and seller terms", false)
  .option("--json", "Output JSON", true)
  .action(async (opts: { confirm: boolean }) => {
    try {
      if (!opts.confirm) throw new TypeError("sell create requires --confirm and approved listing JSON on stdin");
      if (!process.env.TIXBIT_ACCESS_TOKEN) {
        output(await client.listSellerListings(), true);
        return;
      }
      if (process.stdin.isTTY) throw new TypeError("Provide listing JSON on stdin");
      let input = "";
      for await (const chunk of process.stdin) {
        input += chunk.toString();
        if (Buffer.byteLength(input) > 65536) throw new TypeError("Listing JSON exceeds 64 KiB");
      }
      let body: unknown;
      try { body = JSON.parse(input); } catch { throw new TypeError("Invalid listing JSON on stdin"); }
      output(await client.createSellerListing(body, process.env.TIXBIT_ACCESS_TOKEN ?? "", opts.confirm), true);
    } catch (error) { handleError(error); }
  });

// ── checkout ────────────────────────────────────────────────────────────────

program
  .command("checkout <listingId>")
  .description("Get a checkout link to buy tickets for a listing")
  .requiredOption("--quantity <n>", "Number of tickets to buy")
  .option("--json", "Output raw JSON", true)
  .action(async (listingId: string, opts: { quantity: string; json?: boolean }) => {
    try {
      const quantity = Number(opts.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 8) {
        throw new TypeError("--quantity must be an integer from 1 to 8");
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

// ── purchase ───────────────────────────────────────────────────────────────────────────

program
  .command("purchase <listingId>")
  .description("Buy tickets through MPP machine checkout")
  .requiredOption("--quantity <n>", "Number of tickets to buy")
  .option("--email <email>", "Buyer email for confirmation and delivery")
  .option("--name <name>", "Optional buyer/recipient name")
  .option(
    "--idempotency-key <uuid>",
    "Stable UUID v4 to reuse for retries and recovery",
  )
  .option("--account <name>", "mppx account name")
  .requiredOption("--max-price <total>", "Maximum total USD payment")
  .option("--confirm", "Approve this MPP payment", false)
  .option("--json", "Output agent-readable JSON", true)
  .action(async (listingId: string, opts: {
    quantity: string;
    email?: string;
    name?: string;
    idempotencyKey?: string;
    account?: string;
    maxPrice: string;
    confirm: boolean;
    json: boolean;
  }) => {
    let publicErrorCode = "INVALID_PURCHASE_REQUEST";
    let publicErrorMessage = "Invalid purchase request.";
    try {
      if (!opts.confirm) throw new TypeError("purchase requires --confirm before loading the wallet");
      const maxAmountCents = usdCents(opts.maxPrice);
      if (!opts.idempotencyKey) throw new TypeError("purchase requires --idempotency-key for safe recovery");
      if (!opts.email?.trim()) {
        throw new TypeError("--email is required for machine purchases");
      }
      const purchase = normalizePurchaseTicketsParams({
        listingId,
        quantity: Number(opts.quantity),
        email: opts.email,
        name: opts.name,
        idempotencyKey: opts.idempotencyKey,
      });
      const paymentEndpoint = process.env.TIXBIT_PAYMENT_URL;
      new TixBitClient({ paymentEndpoint });
      publicErrorCode = "MPP_CLIENT_SETUP_FAILED";
      publicErrorMessage =
        "MPP payment client setup failed. Check the selected mppx account and local wallet configuration.";

      const [{ Mppx, tempo }, { resolveAccount }] = await Promise.all([
        import("mppx/client"),
        import("mppx/cli"),
      ]);
      const account = await resolveAccount(opts.account);
      const payments = Mppx.create({
        methods: [tempo({ account })],
        polyfill: false,
        maxPaymentRetries: 1,
        onChallenge: async (challenge) => {
          assertMppChallenge(challenge, maxAmountCents);
          return undefined;
        },
      });
      const purchaseClient = new TixBitClient({
        baseUrl: process.env.TIXBIT_BASE_URL,
        paymentEndpoint,
        paymentFetch: (input, init) => payments.fetch(input, init),
      });
      const result = await purchaseClient.purchaseTickets(purchase);

      if (opts.json) {
        output(result, true);
      } else {
        outputPurchaseResult(result);
      }
      if (!result.success) process.exitCode = 2;
    } catch (err) {
      const message =
        publicErrorCode === "INVALID_PURCHASE_REQUEST" && err instanceof Error
          ? err.message
          : publicErrorMessage;
      if (!opts.json) {
        process.stderr.write(`Error: ${message}\n`);
        process.exitCode = 1;
        return;
      }
      output(
        {
          success: false,
          status: "rejected",
          orderReference: null,
          receiptUrl: null,
          error: {
            code: publicErrorCode,
            message,
          },
          action:
            publicErrorCode === "INVALID_PURCHASE_REQUEST"
              ? "Correct the request before attempting payment."
              : "Fix the local mppx account configuration, then retry with the same idempotency key.",
        },
        true,
      );
      process.exitCode = 1;
    }
  });

// ── seatmap ─────────────────────────────────────────────────────────────────

program
  .command("seatmap <eventId>")
  .description("Show the seating chart / section map for an event's venue")
  .option("--section <name>", "Highlight a specific section (case-insensitive)")
  .option("--json", "Output raw JSON (for agents)", true)
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
  .option("--json", "Output JSON", true)
  .action((slug: string) => {
    output({ url: client.eventUrl(slug) }, true);
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

function configureCommands(command: Command): void {
  command.exitOverride();
  command.configureOutput({
    writeOut: (text) => output({ help: text }, true),
    writeErr: () => {},
  });
  for (const child of command.commands) configureCommands(child);
}
configureCommands(program);
try {
  await program.parseAsync();
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code !== "commander.helpDisplayed" && code !== "commander.version") {
    output({ success: false, error: { code: "INVALID_COMMAND", message: "Invalid command or options. Use --help." } }, true);
    process.exitCode = 1;
  }
}
