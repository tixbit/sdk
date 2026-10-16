// Test-only preload. Never delegates to real fetch.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const scenario = process.env.TIXBIT_TEST_SCENARIO;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(String(init.body)) : undefined;
  appendFileSync(process.env.TIXBIT_TEST_LOG, JSON.stringify({ url: String(input), ...init, body, signal: undefined }) + "\n");
  if (scenario === "error") return Response.json({ error: "spt_fixture seller_fixture" }, { status: 403 });
  if (url.pathname === "/api/events/search") return Response.json({ events: [{ id: "AbCd12", name: "Fixture event" }], pagination: { page: 1, size: 10, total: 1, totalPages: 1 } });
  if (url.pathname.endsWith("/listings") && url.pathname.startsWith("/api/events/")) return Response.json({ success: true, data: [{ id: "AbCd12", price_per_ticket: 12.5, quantity: 2 }], meta: { freshness: scenario === "stale" ? "cached" : "live" } });
  if (url.pathname === "/api/agentic/checkout") {
    if (body.sharedPaymentToken && scenario === "ambiguous") throw new Error("spt_fixture");
    return Response.json({ success: true, data: { listingId: body.listingId, quantity: body.quantity, amountCents: scenario === "overcap" ? 99999 : 2500, currency: "usd", maxAmountCentsSupported: scenario !== "old-server", ...(body.sharedPaymentToken ? { orderId: "order-fixture", status: "fulfilled", sharedPaymentToken: body.sharedPaymentToken } : {}) } });
  }
  if (url.pathname === "/api/oauth/token") return Response.json({ access_token: "seller_fixture", token_type: "Bearer", expires_in: 3600 });
  if (url.pathname === "/api/seller/confirm") {
    const marker = process.env.TIXBIT_TEST_LOG + ".lost";
    if (scenario === "seller-uncertain" && !existsSync(marker)) { writeFileSync(marker, "1"); throw new Error("seller_fixture"); }
    return Response.json({ listing: { listingId: "sl_fixture", status: "active" } });
  }
  if (url.pathname === "/api/seller/cancel") return Response.json({ cancelled: true });
  if (url.pathname.startsWith("/api/seller/reviews/")) return Response.json({ review: { id: "11111111-1111-4111-8111-111111111111", status: "completed", operation: "seller.create" } });
  if (url.pathname === "/api/seller/capabilities") return Response.json({ configured: true, quantityUpdate: false });
  if (url.pathname === "/api/seller/inventory") return Response.json({ listings: [{ listingId: "sl_fixture", status: "active" }] });
  if (url.pathname === "/api/seller/prepare") return Response.json({ review: { id: "11111111-1111-4111-8111-111111111111", operation: { name: body.operation, body: body.body }, expiresAt: Date.now() + 60000 }, confirmation: { reviewId: "11111111-1111-4111-8111-111111111111", nonce: "x".repeat(43) } });
  if (url.pathname === "/api/sell/listings") return Response.json({ success: true, data: { listings: [], ...(body ? { listingId: "sl_fixture", status: "pending" } : {}), accessToken: "seller_fixture", message: "seller_fixture" } });
  if (url.pathname.startsWith("/api/listings/")) return Response.json({ success: true, listing: { id: "AbCd12", quantity: 2, price: 12.5 } });
  if (url.pathname === "/api/events") return Response.json({ events: [], total: 0 });
  if (url.pathname.endsWith("/seating-chart")) return Response.json({ success: false });
  throw new Error("Unexpected mocked endpoint");
};
