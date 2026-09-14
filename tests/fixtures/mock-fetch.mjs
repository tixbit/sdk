// Test-only preload. Never delegates to real fetch.
import { appendFileSync } from "node:fs";
const scenario = process.env.TIXBIT_TEST_SCENARIO;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  appendFileSync(process.env.TIXBIT_TEST_LOG, JSON.stringify({ url: String(input), ...init, body, signal: undefined }) + "\n");
  if (scenario === "error") return Response.json({ error: "spt_fixture seller_fixture" }, { status: 403 });
  if (url.pathname === "/api/events/search") return Response.json({ events: [{ id: "AbCd12", name: "Fixture event" }], pagination: { page: 1, size: 10, total: 1, totalPages: 1 } });
  if (url.pathname.endsWith("/listings") && url.pathname.startsWith("/api/events/")) return Response.json({ success: true, data: [{ id: "AbCd12", price_per_ticket: 12.5, quantity: 2 }], meta: { freshness: scenario === "stale" ? "cached" : "live" } });
  if (url.pathname === "/api/agentic/checkout") {
    if (body.sharedPaymentToken && scenario === "ambiguous") throw new Error("spt_fixture");
    return Response.json({ success: true, data: { listingId: body.listingId, quantity: body.quantity, amountCents: scenario === "overcap" ? 99999 : 2500, currency: "usd", maxAmountCentsSupported: scenario !== "old-server", ...(body.sharedPaymentToken ? { orderId: "order-fixture", status: "fulfilled", sharedPaymentToken: body.sharedPaymentToken } : {}) } });
  }
  if (url.pathname === "/api/sell/listings") return Response.json({ success: true, data: { listings: [], ...(body ? { listingId: "sl_fixture", status: "pending" } : {}), accessToken: "seller_fixture", message: "seller_fixture" } });
  if (url.pathname.startsWith("/api/listings/")) return Response.json({ success: true, listing: { id: "AbCd12", quantity: 2, price: 12.5 } });
  if (url.pathname === "/api/events") return Response.json({ events: [], total: 0 });
  if (url.pathname.endsWith("/seating-chart")) return Response.json({ success: false });
  throw new Error("Unexpected mocked endpoint");
};
