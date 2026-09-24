import { Challenge, Credential } from "mppx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const execMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execMock }));
const { startLinkPurchase, completeLinkPurchase } = await import("../src/link.js");

const reference = "TBM-A23456789B";
const networkId = "profile_abcdefghijklmnopqrstuvwxyz";
const approval = `https://app.link.com/activity/approve/lsrq_fixture123`;
const input = { listingId: "AbCd12", quantity: 1, email: "buyer@example.com", maxAmountCents: 250 };
const priorFetch = globalThis.fetch;
const priorState = process.env.XDG_STATE_HOME;
const priorEndpoint = process.env.TIXBIT_PAYMENT_URL;
const dirs: string[] = [];

function setup(status: "approved" | "pending_approval" | "denied" = "approved", paidStatus = 200, wrapped = false,
  recoveredStatus: "fulfilled" | "payment_failed" | "rejected" = "fulfilled") {
  const dir = mkdtempSync(`${tmpdir()}/tixbit-link-test-`);
  dirs.push(dir);
  process.env.XDG_STATE_HOME = dir;
  process.env.TIXBIT_PAYMENT_URL = "http://127.0.0.1:54322/api/purchase";
  execMock.mockImplementation((_binary: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => {
    const command = args[2];
    const result = command === "create"
      ? { id: "lsrq_fixture123", status: "pending_approval", approval_url: approval }
      : { id: "lsrq_fixture123", status, amount: 201, currency: "usd", network_id: networkId,
          credential_type: "shared_payment_token", shared_payment_token: { id: "spt_fixture123" } };
    callback(null, JSON.stringify(wrapped ? { ok: true, data: [result] } : [result]), "");
  });
  const calls: Array<{ body: Record<string, unknown>; authorization: string | null }> = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const authorization = new Headers(init?.headers).get("authorization");
    calls.push({ body, authorization });
    if (!authorization && paidStatus === 502 && calls.length > 3) {
      if (recoveredStatus !== "fulfilled") {
        return Response.json({ success: false, status: recoveredStatus, orderReference: reference }, { status: 409 });
      }
      return Response.json({ success: true, status: "fulfilled", orderReference: reference,
        receiptUrl: "https://www.tixbit.com/orders/2356ec4d-1fe4-4fd7-99f9-3cc315d55511",
        order: { reference, status: "fulfilled", listingId: "AbCd12", quantity: 1,
          pricePerTicket: 2.01, subtotal: 2.01, fees: 0, total: 2.01, currency: "USD" } });
    }
    const challenge = Challenge.from({ id: "stripe-challenge-fixture", realm: "mcp.tixbit.test",
      method: "stripe", intent: "charge", request: {
        amount: "201", currency: "usd", externalId: reference,
        methodDetails: { networkId },
      },
    });
    if (!authorization) return Response.json({ status: "payment_required", orderReference: reference },
      { status: 402, headers: { "WWW-Authenticate": Challenge.serialize(challenge) } });
    if (paidStatus === 402) return Response.json({ status: "payment_required", orderReference: reference,
      detail: "Payment verification failed: Stripe PaymentIntent failed: Your card was declined.." },
      { status: 402, headers: { "WWW-Authenticate": Challenge.serialize(challenge) } });
    if (paidStatus === 501) return Response.json({ success: false, status: "manual_review_required",
      orderReference: reference }, { status: 502 });
    if (paidStatus === 502) return Response.json({ status: 502 }, { status: 502 });
    return Response.json({ success: true, status: "fulfilled", orderReference: reference, receiptUrl: null,
      order: { reference, status: "fulfilled", listingId: "AbCd12", quantity: 1,
        pricePerTicket: 2.01, subtotal: 2.01, fees: 0, total: 2.01, currency: "USD" } });
  }) as typeof fetch;
  return { calls, dir };
}

afterEach(() => {
  globalThis.fetch = priorFetch;
  if (priorState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = priorState;
  if (priorEndpoint === undefined) delete process.env.TIXBIT_PAYMENT_URL; else process.env.TIXBIT_PAYMENT_URL = priorEndpoint;
  execMock.mockReset();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Link CLI checkout", () => {
  it("returns an approval URL, then pays once with the exact order reference", async () => {
    const { calls, dir } = setup();
    const started = await startLinkPurchase(input);
    expect(started).toMatchObject({ status: "approval_required", orderReference: reference, amountCents: 201, approvalUrl: approval });
    expect(execMock.mock.calls[0][1]).toContain(`order_reference:${reference}`);
    expect(execMock.mock.calls[0][1].join(" ")).toContain(`order ${reference}`);
    expect(calls).toHaveLength(1);
    const saved = readFileSync(`${dir}/tixbit/link/${reference}.json`, "utf8");
    expect(saved).not.toContain("spt_fixture123");
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: true, status: "fulfilled", orderReference: reference });
    expect(execMock.mock.calls[1][1]).toContain("shared_payment_token");
    expect(calls).toHaveLength(3);
    expect(calls[0].body).toEqual(calls[1].body);
    expect(calls[1].body).toEqual(calls[2].body);
    const credential = Credential.deserialize<{ externalId: string; spt: string }>(calls[2].authorization!);
    expect(credential.payload).toEqual({ externalId: reference, spt: "spt_fixture123" });
    expect(await completeLinkPurchase(reference)).toEqual(result);
    expect(calls).toHaveLength(3);
  });

  it("does not send payment before approval", async () => {
    const { calls } = setup("pending_approval");
    await startLinkPurchase(input);
    const result = await completeLinkPurchase(reference);
    expect(result.status).toBe("approval_required");
    expect(calls).toHaveLength(1);
  });

  it("accepts wrapped Link CLI JSON output", async () => {
    setup("approved", 200, true);
    await startLinkPurchase(input);
    expect((await completeLinkPurchase(reference)).status).toBe("fulfilled");
  });

  it("treats denied approval as final", async () => {
    const { calls } = setup("denied");
    await startLinkPurchase(input);
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: false, status: "rejected", error: { code: "LINK_APPROVAL_ENDED" } });
    expect(calls).toHaveLength(1);
  });

  it("reports a declined card and never claims a ticket was issued", async () => {
    const { calls } = setup("approved", 402);
    await startLinkPurchase(input);
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: false, status: "payment_failed", error: { code: "CARD_DECLINED" } });
    expect(calls).toHaveLength(3);
  });

  it("does not submit payment again after an ambiguous server error", async () => {
    const { calls } = setup("approved", 502);
    await startLinkPurchase(input);
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: false, status: "pending",
      error: { code: "PURCHASE_OUTCOME_AMBIGUOUS" },
      action: expect.stringContaining("Do not retry") });
    const recovered = await completeLinkPurchase(reference);
    expect(recovered).toMatchObject({ success: true, status: "fulfilled",
      receiptUrl: "https://www.tixbit.com/orders/2356ec4d-1fe4-4fd7-99f9-3cc315d55511" });
    expect(calls).toHaveLength(4);
    expect(calls[3].authorization).toBeNull();
  });

  it.each(["payment_failed", "rejected"] as const)("preserves a terminal %s recovery result", async status => {
    const { calls } = setup("approved", 502, false, status);
    await startLinkPurchase(input);
    expect((await completeLinkPurchase(reference)).status).toBe("pending");
    const recovered = await completeLinkPurchase(reference);
    expect(recovered).toMatchObject({ success: false, status });
    expect(await completeLinkPurchase(reference)).toEqual(recovered);
    expect(calls).toHaveLength(4);
    expect(calls[3].authorization).toBeNull();
  });

  it("does not downgrade a known paid manual-review result during a later status check", async () => {
    const { calls } = setup("approved", 501);
    await startLinkPurchase(input);
    const first = await completeLinkPurchase(reference);
    expect(first.status).toBe("manual_review_required");
    expect(await completeLinkPurchase(reference)).toEqual(first);
    expect(calls).toHaveLength(4);
    expect(calls[3].authorization).toBeNull();
  });

  it("rejects a recovery response for a different order", async () => {
    setup("approved", 502);
    await startLinkPurchase(input);
    expect((await completeLinkPurchase(reference)).status).toBe("pending");
    globalThis.fetch = vi.fn(async () => Response.json({ success: true, status: "fulfilled",
      orderReference: "TBM-B23456789C" })) as typeof fetch;
    await expect(completeLinkPurchase(reference)).rejects.toMatchObject({ code: "ORDER_REFERENCE_CHANGED" });
  });

  it("keeps an unbound recovery rejection pending", async () => {
    setup("approved", 502);
    await startLinkPurchase(input);
    expect((await completeLinkPurchase(reference)).status).toBe("pending");
    const recoveryFetch = vi.fn(async () => Response.json({ success: false, status: "rejected" }, { status: 409 }));
    globalThis.fetch = recoveryFetch as typeof fetch;
    expect((await completeLinkPurchase(reference)).status).toBe("pending");
    expect((await completeLinkPurchase(reference)).status).toBe("pending");
    expect(recoveryFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an amount over the buyer's cap before creating a spend request", async () => {
    setup();
    await expect(startLinkPurchase({ ...input, maxAmountCents: 200 })).rejects.toMatchObject({ code: "STRIPE_CHALLENGE_UNSAFE" });
    expect(execMock).not.toHaveBeenCalled();
  });

  it.each([
    ["You cannot submit duplicate spend requests within a short period of time.", "LINK_DUPLICATE_REQUEST", false],
    ["Invalid network_id: could not retrieve merchant information.", "LINK_NETWORK_UNAVAILABLE", false],
    ["Invalid network_id: could not retrieve merchant information.", "LINK_NETWORK_UNAVAILABLE", true],
  ])("reports a safe Link error for %s (wrapped: %s)", async (message, code, wrapped) => {
    setup();
    execMock.mockImplementation((_binary: string, _args: string[], _options: unknown,
      callback: (error: Error, stdout: string, stderr: string) => void) => {
      const stdout = JSON.stringify(wrapped
        ? { ok: false, error: { code: "LINK_API_ERROR", message } }
        : [{ code: "LINK_API_ERROR", message }]);
      callback(Object.assign(new Error("Link failed"), { stdout }), stdout, "");
    });
    await expect(startLinkPurchase(input)).rejects.toMatchObject({ code });
  });
});
