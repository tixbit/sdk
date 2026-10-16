import { redact } from "./safety.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, lstat, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SELLER_ORIGIN = "https://mcp.tixbit.com";
export const SELLER_CALLBACK = `${SELLER_ORIGIN}/cli/callback`;
export const DEFAULT_SELLER_CLIENT_ID = "tixbit-client.eyJ0eXAiOiJjbGllbnQiLCJpYXQiOjE3OTIxOTI4MDAsImNsaWVudE5hbWUiOiJUaXhCaXQgQ0xJIiwicmVkaXJlY3RVcmlzIjpbImh0dHBzOi8vbWNwLnRpeGJpdC5jb20vY2xpL2NhbGxiYWNrIl0sInNjb3BlIjoibWNwOnJlYWQgaW52ZW50b3J5OnJlYWQgc2VsbGVyOndyaXRlIn0.C9ijXrH07kd2p15Dd1z5yzfVsz4XoBUJI90GP9Rbg7k";
export const SELLER_SCOPES = "mcp:read inventory:read seller:write";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const disclosures = ["ada", "twenty_one_plus", "obstructed_view", "limited_view", "standing_room", "aisle_seat"];
export type SellerOperation = "seller.create" | "seller.reprice" | "seller.delist";
export class SellerError extends Error {
  constructor(public code: string, message: string, public action: string, public retryable = false) { super(message); }
}
export function sellerId(value: string): string {
  if (!uuid.test(value)) throw new TypeError("Review and attempt IDs must be UUID v4 values");
  return value;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError(`${label} must be nonempty text (max ${max} characters)`);
  return value.trim();
}
/** Strictly validate the actual seller API contract; no payment or fulfillment fields. */
export function normalizeSellerOperation(operation: SellerOperation, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a JSON object");
  const b = value as Record<string, unknown>;
  const allowed = operation === "seller.create" ? ["externalEventId", "section", "quantity", "priceCents", "termsAccepted", "row", "seatNumbers", "generalAdmission", "faceValueCents", "disclosures", "notes", "ownedImportId"] : operation === "seller.reprice" ? ["listingId", "priceCents"] : ["listingId"];
  for (const key of Object.keys(b)) if (!allowed.includes(key)) throw new TypeError(`Unsupported seller field: ${key}. Quantity edits and fulfillment/payment changes are unavailable.`);
  const result: Record<string, unknown> = {};
  if (operation !== "seller.create") result.listingId = text(b.listingId, "listingId", 128);
  if (operation !== "seller.delist") {
    if (!Number.isSafeInteger(b.priceCents) || (b.priceCents as number) < 100 || (b.priceCents as number) > 5_000_000) throw new TypeError("priceCents must be an integer from 100 to 5000000 (USD per ticket)");
    result.priceCents = b.priceCents;
  }
  if (operation === "seller.create") {
    result.externalEventId = text(b.externalEventId, "externalEventId", 128);
    result.section = text(b.section, "section", 128);
    if (!Number.isInteger(b.quantity) || (b.quantity as number) < 1 || (b.quantity as number) > 20) throw new TypeError("quantity must be an integer from 1 to 20");
    if (b.termsAccepted !== true) throw new TypeError("Seller approval requires termsAccepted: true");
    result.quantity = b.quantity; result.termsAccepted = true;
    for (const key of ["row", "notes", "ownedImportId"]) if (b[key] !== undefined) result[key] = text(b[key], key, key === "notes" ? 280 : key === "row" ? 64 : 100);
    if (b.generalAdmission !== undefined) {
      if (typeof b.generalAdmission !== "boolean") throw new TypeError("generalAdmission must be a boolean");
      result.generalAdmission = b.generalAdmission;
    }
    if (b.seatNumbers !== undefined) {
      if (!Array.isArray(b.seatNumbers) || (b.seatNumbers.length > 0 && b.seatNumbers.length !== b.quantity) || new Set(b.seatNumbers).size !== b.seatNumbers.length) throw new TypeError("seatNumbers must contain one distinct seat per ticket");
      result.seatNumbers = b.seatNumbers.map(s => text(s, "seatNumber", 16));
    }
    if (b.faceValueCents !== undefined) {
      if (!Number.isSafeInteger(b.faceValueCents) || (b.faceValueCents as number) < 0 || (b.faceValueCents as number) > 5_000_000) throw new TypeError("faceValueCents must be a nonnegative integer");
      result.faceValueCents = b.faceValueCents;
    }
    if (b.ownedImportId !== undefined && !/^ori_[0-9a-f-]{36}$/i.test(String(b.ownedImportId))) throw new TypeError("ownedImportId must be a TixBit-owned resale import ID");
    if (b.generalAdmission === true && (b.row || (Array.isArray(b.seatNumbers) && b.seatNumbers.length))) throw new TypeError("General admission cannot include a row or seat numbers");
    if (b.generalAdmission !== true && (!b.row || (!b.ownedImportId && (!Array.isArray(b.seatNumbers) || !b.seatNumbers.length)))) throw new TypeError("Reserved seating requires row and exact seatNumbers matching quantity; use generalAdmission: true only for GA tickets");
    if (Array.isArray(b.seatNumbers) && b.seatNumbers.some(s => /^(tbd|unknown|n\/?a|pending)$/i.test(s.trim()))) throw new TypeError("Exact seat numbers are required; placeholder seats are not accepted");
    if (b.disclosures !== undefined) {
      if (!Array.isArray(b.disclosures) || b.disclosures.some(d => !disclosures.includes(d))) throw new TypeError(`disclosures must use: ${disclosures.join(", ")}`);
      result.disclosures = [...new Set(b.disclosures)];
    }
  }
  return result;
}

type Session = { accessToken: string; expiresAt: number; clientId: string };
type Pending = { state: string; verifier: string; clientId: string; expiresAt: number };
type SavedReview = { review: { id: string; operation: { name: SellerOperation; body: Record<string, unknown> }; expiresAt: number }; confirmation: { reviewId: string; nonce: string } };
/** Credentials and confirmation capabilities stay in private files, never stdout or argv. */
export class SellerStore {
  constructor(public directory = join(homedir(), ".config", "tixbit", "seller")) {}
  async save(name: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new TypeError("Seller state directory must be a real directory");
    await chmod(this.directory, 0o700);
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, join(this.directory, name));
  }
  async load<T>(name: string): Promise<T> {
    try {
      const path = join(this.directory, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error();
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch { throw new SellerError("LOCAL_STATE_MISSING", "Private seller session or review is missing or unreadable.", "Run sell login, or prepare a new review after checking inventory."); }
  }
  async remove(name: string) { await unlink(join(this.directory, name)).catch(() => {}); }
}

export class SellerClient {
  constructor(public store = new SellerStore(), private fetcher: typeof fetch = fetch) {}
  private async request(path: string, body?: unknown, token?: string): Promise<any> {
    let response: Response;
    try {
      response = await this.fetcher(`${SELLER_ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(30000) });
    } catch { throw new SellerError("SELLER_OUTCOME_UNKNOWN", "The seller service response was not received.", "For a confirm, retry the SAME review ID. For prepare, check inventory before preparing another attempt.", true); }
    const data = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const errors: Record<string, { message: string; action: string }> = {
        authentication_required: { message: "Seller sign-in is required.", action: "Run tixbit sell login to authorize this CLI." },
        seller_unavailable: { message: "Seller account support is not configured.", action: "Ask the operator to configure the seller account bridge and approved OAuth client." },
        permission_required: { message: "Current seller account permission is required.", action: "Check seller ownership, sign in to the correct account, and reconnect to grant inventory:read and seller:write." },
        invalid_request: { message: "The seller request is invalid.", action: "Check required fields, exact event and seat IDs, quantity, price in cents and UUID attempt. Correct the request before preparing again." },
        invalid_content_type: { message: "The seller request requires JSON.", action: "Use the documented CLI JSON input or send application/json to the API." },
        account_unavailable: { message: "The seller account service is temporarily unavailable.", action: path === "/api/seller/confirm" ? "Read review status and inventory before retrying. Retain the SAME review ID and confirmation; do not prepare a new mutation attempt." : "Retry the read when service recovers. For preparation, reconcile inventory and the existing attempt before preparing again." },
        review_or_listing_unavailable: { message: "The review or owned listing is unavailable.", action: "Run sell list to refresh owned inventory. Use an owned listing or review ID and check that the review has not expired." },
        review_conflict: { message: "The seller review changed, expired or requires reconciliation.", action: "Read sell review and sell list. Retain the existing confirmation; never repeat an uncertain mutation with a new attempt." },
      };
      const code = typeof data?.error?.code === "string" && Object.hasOwn(errors, data.error.code) ? data.error.code as string : null;
      if (code) {
        const known = errors[code]!;
        throw new SellerError(code, known.message, known.action, data.error.retryable === true);
      }
      throw new SellerError(`SELLER_HTTP_${response.status}`, `Seller request failed (HTTP ${response.status}).`, "Check command input and service status. Reconcile review status and inventory before retrying any mutation.", false);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new SellerError("INVALID_SELLER_RESPONSE", "Seller service returned an invalid response.", "Check review status and inventory before another attempt.");
    return redact(data, [token ?? ""]);
  }
  async token(): Promise<string> {
    const session = await this.store.load<Session>("session.json");
    if (!session.accessToken || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) throw new SellerError("SELLER_LOGIN_EXPIRED", "Seller sign-in has expired.", "Run sell login again. Saved reviews can be checked after sign-in.");
    return session.accessToken;
  }
  capabilities() { return this.request("/api/seller/capabilities"); }
  async inventory() { return this.request("/api/seller/inventory", undefined, await this.token()); }
  async status(id?: string) {
    const inventory = await this.inventory();
    if (!id) return inventory;
    const listing = inventory.listings?.find((l: any) => l.listingId === id);
    if (!listing) throw new SellerError("LISTING_NOT_FOUND", "Listing not found in this seller account.", "Run sell list and choose an owned listing ID.");
    return { listing };
  }
  async prepare(operation: SellerOperation, body: unknown, attempt: string = randomUUID()) {
    sellerId(attempt);
    const normalized = normalizeSellerOperation(operation, body);
    const token = await this.token();
    // Reserve locally before dispatch so a lost response cannot cause an accidental resubmission.
    try { await this.store.load(`attempt-${attempt}.json`); throw new SellerError("ATTEMPT_ALREADY_SENT", "This preparation attempt has already been sent.", "Check sell list and sell review before starting a new attempt."); }
    catch (error) { if (!(error instanceof SellerError) || error.code !== "LOCAL_STATE_MISSING") throw error; }
    await this.store.save(`attempt-${attempt}.json`, { operation, body: normalized, attempt });
    let result: SavedReview;
    try { result = await this.request("/api/seller/prepare", { operation, body: normalized, attempt }, token) as SavedReview; }
    catch (error) {
      if (error instanceof SellerError) error.action += ` Preparation attempt: ${attempt}.`;
      throw error;
    }
    if (!result.review || !uuid.test(result.review.id) || result.confirmation?.reviewId !== result.review.id || !/^[A-Za-z0-9_-]{43}$/.test(result.confirmation.nonce)) throw new SellerError("INVALID_SELLER_REVIEW", "Invalid server review.", "Check inventory before another attempt.");
    await this.store.save(`review-${result.review.id}.json`, result);
    return { review: result.review, attempt, action: `Review the operation and seller terms. To approve: tixbit sell confirm ${result.review.id} --confirm. To abandon: tixbit sell cancel ${result.review.id}. Submission does not guarantee a live marketplace listing.` };
  }
  async review(id: string) { return this.request(`/api/seller/reviews/${sellerId(id)}`, undefined, await this.token()); }
  async confirm(id: string, approved: boolean) {
    if (approved !== true) throw new TypeError("Explicit approval requires --confirm after reviewing the prepared operation");
    const saved = await this.store.load<SavedReview>(`review-${sellerId(id)}.json`);
    if (saved.confirmation?.reviewId !== id) throw new TypeError("Review identity mismatch");
    return this.request("/api/seller/confirm", saved.confirmation, await this.token());
  }
  async cancel(id: string) {
    const saved = await this.store.load<SavedReview>(`review-${sellerId(id)}.json`);
    return this.request("/api/seller/cancel", saved.confirmation, await this.token());
  }
  async logout() { await this.store.remove("session.json"); await this.store.remove("login.json"); return { signedIn: false, action: "Local credentials removed. To revoke an existing grant, use your TixBit account connections." }; }
  async authStatus() {
    try { const session = await this.store.load<Session>("session.json"); return { signedIn: session.expiresAt > Date.now(), expiresAt: session.expiresAt, action: "Run sell list to validate current server access. Local status does not prove the grant is still active." }; }
    catch { return { signedIn: false, action: "Run tixbit sell login to sign in with the built-in public CLI client." }; }
  }
  async startLogin(clientId: string = DEFAULT_SELLER_CLIENT_ID) {
    text(clientId, "clientId", 8192);
    const pending: Pending = { clientId, state: randomBytes(32).toString("base64url"), verifier: randomBytes(32).toString("base64url"), expiresAt: Date.now() + 600000 };
    await this.store.save("login.json", pending);
    const url = new URL(`${SELLER_ORIGIN}/api/oauth/authorize`);
    for (const [key, value] of Object.entries({ response_type: "code", client_id: clientId, redirect_uri: SELLER_CALLBACK, scope: SELLER_SCOPES, resource: `${SELLER_ORIGIN}/api/mcp`, state: pending.state, code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"), code_challenge_method: "S256" })) url.searchParams.set(key, value);
    return { signInUrl: url.toString(), action: "Open this URL in your browser, sign in and approve seller access. Then run tixbit sell login --complete and paste the full callback URL on stdin. Never paste tokens or browser cookies.", expiresAt: pending.expiresAt };
  }
  async completeLogin(callback: string) {
    const pending = await this.store.load<Pending>("login.json");
    let url: URL;
    try { url = new URL(callback.trim()); } catch { throw new TypeError("Paste the full TixBit callback URL from your browser"); }
    if (url.origin + url.pathname !== SELLER_CALLBACK || url.hash || url.username || url.password || pending.expiresAt <= Date.now() || url.searchParams.get("state") !== pending.state || url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length !== 1 || !url.searchParams.get("code") || url.searchParams.has("error")) throw new TypeError("Callback URL, state, or login expiry does not match. Run sell login again.");
    await this.store.remove("login.json"); // One exchange attempt only: a lost response may have consumed the code.
    let response: Response;
    try { response = await this.fetcher(`${SELLER_ORIGIN}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: pending.clientId, redirect_uri: SELLER_CALLBACK, resource: `${SELLER_ORIGIN}/api/mcp`, code: url.searchParams.get("code")!, code_verifier: pending.verifier }), redirect: "error", signal: AbortSignal.timeout(30000) }); }
    catch { throw new SellerError("LOGIN_EXCHANGE_FAILED", "Could not complete login.", "Run sell login again; do not reuse an uncertain authorization code."); }
    const result = await response.json().catch(() => null) as any;
    await this.store.remove("login.json");
    if (!response.ok || typeof result?.access_token !== "string" || !result.access_token || result.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new SellerError("LOGIN_EXCHANGE_FAILED", "Seller authorization was not granted.", "Run sell login again. Ask the operator to approve the CLI client and seller scopes if unavailable.");
    await this.store.save("session.json", { accessToken: result.access_token, clientId: pending.clientId, expiresAt: Date.now() + result.expires_in * 1000 });
    return { signedIn: true, expiresIn: result.expires_in, action: "Run tixbit sell list to inspect your inventory." };
  }
}
