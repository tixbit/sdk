import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { Challenge } from "mppx";
import { Mppx, stripe } from "mppx/client";
import { normalizePurchaseTicketsParams, TixBitClient } from "./client.js";
import type { PurchaseTicketsResult } from "./types.js";

const execFileAsync = promisify(execFile);
const PAYMENT_URL = "https://mcp.tixbit.com/api/purchase";
const ORDER_REFERENCE = /^TBM-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
const NETWORK_ID = /^profile_[A-Za-z0-9]+$/;
const SPEND_REQUEST_ID = /^lsrq_[A-Za-z0-9]+$/;
const require = createRequire(import.meta.url);

function linkCliEntry(): string {
  if (Number(process.versions.node.split(".")[0]) < 22) {
    throw new LinkCheckoutError("LINK_NODE_UNSUPPORTED", "TixBit 0.2.0 needs Node.js 22 or later.");
  }
  try { return join(dirname(require.resolve("@stripe/link-cli/package.json")), "dist", "cli.js"); }
  catch { throw new LinkCheckoutError("LINK_CLI_MISSING", "The bundled Link CLI is missing. Reinstall TixBit, then retry."); }
}

type LinkState = {
  version: 1;
  orderReference: string;
  requestBody: string;
  spendRequestId: string;
  approvalUrl: string;
  amountCents: number;
  networkId: string;
  externalId: string;
  paymentAttempted?: boolean;
  result?: LinkPurchaseOutput;
};

export type LinkPurchaseOutput = {
  success: boolean;
  status: "approval_required" | "payment_required" | "payment_failed" | "pending" | "fulfilled" | "manual_review_required" | "rejected";
  orderReference: string;
  amountCents: number;
  approvalUrl?: string;
  error?: { code: string; message: string };
  action?: string;
  order?: PurchaseTicketsResult["order"];
};

export class LinkCheckoutError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

function paymentEndpoint(): string {
  // The client validates the override and permits only the canonical service or loopback QA.
  const endpoint = process.env.TIXBIT_PAYMENT_URL ?? PAYMENT_URL;
  new TixBitClient({ paymentEndpoint: endpoint });
  return endpoint;
}

function statePath(orderReference: string): string {
  if (!ORDER_REFERENCE.test(orderReference)) throw new LinkCheckoutError("INVALID_ORDER_REFERENCE", "Enter the order reference shown by link start.");
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "tixbit", "link", `${orderReference}.json`);
}

async function saveState(state: LinkState): Promise<void> {
  const path = statePath(state.orderReference);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function loadState(orderReference: string): Promise<LinkState> {
  let value: LinkState;
  try { value = JSON.parse(await readFile(statePath(orderReference), "utf8")) as LinkState; }
  catch { throw new LinkCheckoutError("CHECKOUT_NOT_FOUND", "This Link checkout was not found on this device."); }
  if (value.version !== 1 || value.orderReference !== orderReference ||
      !SPEND_REQUEST_ID.test(value.spendRequestId) || !NETWORK_ID.test(value.networkId) ||
      !Number.isSafeInteger(value.amountCents) || value.amountCents <= 0 ||
      typeof value.externalId !== "string" || !value.externalId ||
      typeof value.requestBody !== "string") {
    throw new LinkCheckoutError("INVALID_CHECKOUT_STATE", "The saved Link checkout is invalid. Contact TixBit support before starting another purchase.");
  }
  return value;
}

async function linkCli(args: string[]): Promise<Record<string, unknown>> {
  let stdout: string;
  const entry = linkCliEntry();
  try {
    const result: unknown = await execFileAsync(process.execPath, [entry, ...args, "--format", "json"], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    stdout = typeof result === "string" ? result : (result as { stdout: string }).stdout;
  } catch (error) {
    const output = error && typeof error === "object" && "stdout" in error
      ? String((error as { stdout: unknown }).stdout) : "";
    let message = "";
    try {
      const parsed = JSON.parse(output) as unknown;
      const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "data" in parsed
        ? (parsed as { data: unknown }).data : parsed;
      const item = Array.isArray(data) ? data[0] : data;
      if (item && typeof item === "object" && "message" in item) {
        message = String((item as { message: unknown }).message);
      } else {
        const nested = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "error" in parsed
          ? (parsed as { error: unknown }).error : undefined;
        if (nested && typeof nested === "object" && "message" in nested) {
          message = String((nested as { message: unknown }).message);
        }
      }
    } catch { /* Never print raw Link output. */ }
    if (/duplicate spend requests|matching spend request/i.test(message)) {
      throw new LinkCheckoutError("LINK_DUPLICATE_REQUEST", "Link blocked a matching spend request. Wait a few minutes, then start a new checkout.");
    }
    if (/Invalid network_id|could not retrieve merchant information/i.test(message)) {
      throw new LinkCheckoutError("LINK_NETWORK_UNAVAILABLE", "Link could not resolve the merchant profile in this account and mode. No payment was sent.");
    }
    throw new LinkCheckoutError("LINK_CLI_FAILED", "Link could not complete this step. Check Link sign-in and payment methods, then retry.");
  }
  try {
    const parsed: unknown = JSON.parse(stdout);
    const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "data" in parsed
      ? (parsed as { data: unknown }).data : parsed;
    const item = Array.isArray(data) ? data[0] : data;
    if (item && typeof item === "object") return item as Record<string, unknown>;
  } catch { /* Never expose Link output, which can contain payment credentials. */ }
  throw new LinkCheckoutError("LINK_CLI_RESPONSE_INVALID", "Link returned an invalid response. No payment was submitted.");
}

function stripeChallenge(response: Response, maxAmountCents: number) {
  let challenges: ReturnType<typeof Challenge.fromResponseList>;
  try { challenges = Challenge.fromResponseList(response); }
  catch { throw new LinkCheckoutError("STRIPE_CHALLENGE_MISSING", "TixBit did not offer a valid Stripe Link payment challenge."); }
  const challenge = challenges.find(item => item.method === "stripe" && item.intent === "charge");
  const request = challenge?.request;
  const amount = Number(request?.amount);
  const details = request?.methodDetails as { networkId?: unknown } | undefined;
  if (!challenge || request?.currency !== "usd" || !Number.isSafeInteger(amount) || amount <= 0 ||
      amount > maxAmountCents || typeof details?.networkId !== "string" ||
      !NETWORK_ID.test(details.networkId) || typeof request.externalId !== "string" || !request.externalId) {
    throw new LinkCheckoutError("STRIPE_CHALLENGE_UNSAFE", "The Stripe challenge is missing order details or exceeds your total price limit.");
  }
  return { amountCents: amount, networkId: details.networkId, externalId: request.externalId };
}

function approvalUrl(value: unknown): string {
  if (typeof value !== "string") throw new LinkCheckoutError("LINK_APPROVAL_MISSING", "Link did not return an approval link.");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new LinkCheckoutError("LINK_APPROVAL_INVALID", "Link returned an unexpected approval link."); }
  if (url.origin !== "https://app.link.com" || !url.pathname.startsWith("/activity/approve/")) {
    throw new LinkCheckoutError("LINK_APPROVAL_INVALID", "Link returned an unexpected approval link.");
  }
  return url.toString();
}

export async function startLinkPurchase(input: {
  listingId: string; quantity: number; email: string; name?: string; maxAmountCents: number;
}): Promise<LinkPurchaseOutput> {
  linkCliEntry();
  const purchase = normalizePurchaseTicketsParams({ ...input, idempotencyKey: randomUUID() });
  if (!Number.isSafeInteger(input.maxAmountCents) || input.maxAmountCents <= 0) {
    throw new LinkCheckoutError("INVALID_MAX_PRICE", "Set a positive total price limit.");
  }
  const requestBody = JSON.stringify(purchase);
  const response = await fetch(paymentEndpoint(), {
    method: "POST", redirect: "error",
    headers: { "content-type": "application/json", "accept-payment": "stripe/charge" },
    body: requestBody,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 402) throw new LinkCheckoutError("PURCHASE_PREPARE_FAILED", `TixBit could not prepare this checkout (HTTP ${response.status}).`);
  const { amountCents, networkId, externalId } = stripeChallenge(response, input.maxAmountCents);
  const body = await response.json() as { orderReference?: unknown };
  if (typeof body.orderReference !== "string" || !ORDER_REFERENCE.test(body.orderReference)) {
    throw new LinkCheckoutError("ORDER_REFERENCE_MISSING", "TixBit did not return an order reference.");
  }
  const context = `Approve one TixBit ticket purchase for order ${body.orderReference}, listing ${purchase.listingId}, quantity ${purchase.quantity}. The total charge is USD ${(amountCents / 100).toFixed(2)}. This request permits one machine payment for this selected order only.`;
  const created = await linkCli([
    "spend-request", "create", "--credential-type", "shared_payment_token",
    "--network-id", networkId, "--amount", String(amountCents), "--currency", "usd",
    "--context", context, "--metadata", `order_reference:${body.orderReference}`, "--request-approval",
  ]);
  if (typeof created.id !== "string" || !SPEND_REQUEST_ID.test(created.id)) {
    throw new LinkCheckoutError("LINK_SPEND_REQUEST_INVALID", "Link did not return a valid spend request.");
  }
  const url = approvalUrl(created.approval_url);
  await saveState({ version: 1, orderReference: body.orderReference, requestBody,
    spendRequestId: created.id, approvalUrl: url, amountCents, networkId, externalId });
  return { success: false, status: "approval_required", orderReference: body.orderReference,
    amountCents, approvalUrl: url, action: `Approve in Link, then run: tixbit link complete ${body.orderReference}` };
}

export async function completeLinkPurchase(orderReference: string): Promise<LinkPurchaseOutput> {
  const state = await loadState(orderReference);
  if (state.result) return state.result;
  if (state.paymentAttempted) return { success: false, status: "pending", orderReference,
    amountCents: state.amountCents,
    error: { code: "PURCHASE_OUTCOME_AMBIGUOUS", message: "Payment may have been submitted, but the result is unknown." },
    action: "Do not retry payment or start another checkout. Contact TixBit support with this order reference." };
  const approval = await linkCli(["spend-request", "retrieve", state.spendRequestId, "--include", "shared_payment_token"]);
  if (["denied", "declined", "expired", "canceled", "cancelled"].includes(String(approval.status))) {
    return { success: false, status: "rejected", orderReference, amountCents: state.amountCents,
      error: { code: "LINK_APPROVAL_ENDED", message: "The Link spend approval ended without payment." },
      action: "Start a new Link checkout if you still want this ticket." };
  }
  if (approval.status !== "approved") {
    return { success: false, status: "approval_required", orderReference, amountCents: state.amountCents,
      approvalUrl: state.approvalUrl, action: "Approve this spend request in Link, then run the same complete command." };
  }
  const token = (approval.shared_payment_token as { id?: unknown } | undefined)?.id;
  if (approval.credential_type !== "shared_payment_token" || approval.amount !== state.amountCents ||
      approval.currency !== "usd" || approval.network_id !== state.networkId ||
      typeof token !== "string" || !/^spt_[A-Za-z0-9_]+$/.test(token)) {
    throw new LinkCheckoutError("LINK_APPROVAL_MISMATCH", "The Link approval does not match this order. No payment was submitted.");
  }
  let challengeChanged = false;
  const payments = Mppx.create({
    methods: [stripe.charge({ paymentMethod: "link", createToken: async ({ amount, currency, networkId }) => {
      if (Number(amount) !== state.amountCents || currency !== "usd" || networkId !== state.networkId) {
        challengeChanged = true;
        throw new LinkCheckoutError("CHALLENGE_CHANGED", "The payment amount or network changed. No payment was submitted.");
      }
      return token;
    } })],
    polyfill: false, maxPaymentRetries: 1,
    onChallenge: async challenge => {
      const request = challenge.request;
      const details = request.methodDetails as { networkId?: unknown } | undefined;
      if (challenge.method !== "stripe" || challenge.intent !== "charge" ||
          Number(request.amount) !== state.amountCents || request.currency !== "usd" ||
          details?.networkId !== state.networkId || request.externalId !== state.externalId) {
        challengeChanged = true;
        throw new LinkCheckoutError("CHALLENGE_CHANGED", "The order or payment amount changed. No payment was submitted.");
      }
      return undefined;
    },
  });
  let decline = false;
  state.paymentAttempted = true;
  await saveState(state);
  const client = new TixBitClient({ paymentEndpoint: paymentEndpoint(), timeoutMs: 90_000,
    paymentFetch: async (url, init) => {
      const response = await payments.fetch(url, { ...init, headers: { ...init?.headers, "accept-payment": "stripe/charge" } });
      if (response.status === 402) {
        const body = await response.clone().json().catch(() => ({})) as { detail?: unknown };
        decline = typeof body.detail === "string" && /card was declined/i.test(body.detail);
      }
      return response;
    },
  });
  const request = JSON.parse(state.requestBody) as { listingId: string; quantity: number; email: string; name?: string; idempotencyKey: string };
  const result = await client.purchaseTickets(request);
  if (challengeChanged) throw new LinkCheckoutError("CHALLENGE_CHANGED", "The order or payment amount changed. No payment was submitted.");
  if (result.orderReference && result.orderReference !== orderReference) {
    throw new LinkCheckoutError("ORDER_REFERENCE_CHANGED", "TixBit returned a different order reference. Check the order before another payment.");
  }
  const output: LinkPurchaseOutput = {
    success: result.success, status: decline ? "payment_failed" : result.status,
    orderReference, amountCents: state.amountCents,
    ...(result.order && !decline ? { order: result.order } : {}),
    ...(!result.success ? {
      error: decline ? { code: "CARD_DECLINED", message: "Stripe declined the card selected in Link." } : result.error,
      action: decline ? "Select another card in Link and start a new spend approval. No ticket was issued."
        : result.status === "pending" ? "Payment may have succeeded. Do not retry or start another checkout. Contact TixBit support with this order reference."
        : result.action,
    } : {}),
  };
  state.result = output;
  await saveState(state);
  return output;
}
