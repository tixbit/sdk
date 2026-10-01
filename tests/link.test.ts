import { Challenge, Credential } from "mppx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  recoveredStatus: "fulfilled" | "payment_failed" | "rejected" = "fulfilled", paidResponse?: () => Response) {
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
    if (!authorization && (paidStatus === 502 || paidResponse) && calls.length > 3) {
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
    if (paidResponse) return paidResponse();
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
    expect(await completeLinkPurchase(reference)).toEqual(result);
    expect(calls).toHaveLength(3);
  });

  it("does not submit payment again after an ambiguous server error", async () => {
    const { calls } = setup("approved", 502);
    await startLinkPurchase(input);
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: false, status: "pending",
      error: { code: "PURCHASE_OUTCOME_AMBIGUOUS" },
      action: expect.stringContaining("Do not start another payment") });
    const recovered = await completeLinkPurchase(reference);
    expect(recovered).toMatchObject({ success: true, status: "fulfilled",
      receiptUrl: "https://www.tixbit.com/orders/2356ec4d-1fe4-4fd7-99f9-3cc315d55511" });
    expect(calls).toHaveLength(4);
    expect(calls[3].authorization).toBeNull();
  });

  it.each([
    { label: "malformed 200", response: () => new Response('{"success":', { status: 200 }) },
    { label: "empty 200", response: () => new Response("", { status: 200 }) },
    { label: "empty 204", response: () => new Response(null, { status: 204 }) },
    { label: "unexpected 202", response: () => Response.json({ success: true, status: "accepted", orderReference: reference }, { status: 202 }) },
    { label: "unconfirmed fulfillment", response: () => Response.json({ status: "fulfilled", orderReference: reference }) },
    { label: "unbound rejection", response: () => Response.json({ success: false, status: "rejected" }, { status: 409 }) },
    { label: "unbound payment failure", response: () => Response.json({ success: false, status: "payment_failed" }, { status: 409 }) },
  ])("recovers $label through the original body without another credential", async ({ response }) => {
    const { calls, dir } = setup("approved", 200, false, "fulfilled", response);
    await startLinkPurchase(input);
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: false, status: "pending", orderReference: reference,
      action: expect.stringContaining("Run the same complete command") });
    const saved = JSON.parse(readFileSync(`${dir}/tixbit/link/${reference}.json`, "utf8"));
    expect(saved.paymentAttempted).toBe(true);
    expect(saved.result.status).toBe("pending");
    const recovered = await completeLinkPurchase(reference);
    expect(recovered).toMatchObject({ success: true, status: "fulfilled", orderReference: reference });
    expect(await completeLinkPurchase(reference)).toEqual(recovered);
    expect(calls).toHaveLength(4);
    expect(calls.filter(call => call.authorization)).toHaveLength(1);
    expect(calls[3].authorization).toBeNull();
    for (const call of calls) expect(call.body).toEqual(calls[0].body);
    expect(calls[3].body.idempotencyKey).toBe(calls[2].body.idempotencyKey);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it.each(["payment_failed", "rejected"] as const)("caches an initial order-bound 4xx %s without another payment", async status => {
    const { calls } = setup("approved", 200, false, "fulfilled", () => Response.json({
      success: false, status, orderReference: reference,
    }, { status: 409 }));
    await startLinkPurchase(input);
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: false, status, orderReference: reference });
    expect(await completeLinkPurchase(reference)).toEqual(result);
    expect(calls).toHaveLength(3);
    expect(calls.filter(call => call.authorization)).toHaveLength(1);
  });

  it.each(["HTTP_200", "HTTP_204"])("reconciles a previously cached %s rejection without retrieving or sending a credential", async code => {
    const { calls, dir } = setup("approved", 502);
    await startLinkPurchase(input);
    const path = `${dir}/tixbit/link/${reference}.json`;
    const saved = JSON.parse(readFileSync(path, "utf8"));
    saved.paymentAttempted = true;
    saved.result = { success: false, status: "rejected", orderReference: reference,
      amountCents: 201, error: { code, message: "Purchase request was rejected or returned an invalid response." } };
    writeFileSync(path, JSON.stringify(saved));
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
      return Response.json({ success: true, status: "fulfilled", orderReference: reference });
    }) as typeof fetch;
    const result = await completeLinkPurchase(reference);
    expect(result).toMatchObject({ success: true, status: "fulfilled", orderReference: reference });
    expect(await completeLinkPurchase(reference)).toEqual(result);
    expect(calls).toHaveLength(2);
    expect(calls[1].authorization).toBeNull();
    expect(calls[1].body).toEqual(JSON.parse(saved.requestBody));
    expect(execMock).toHaveBeenCalledTimes(1);
    const recovered = JSON.parse(readFileSync(path, "utf8"));
    expect(recovered.paymentAttempted).toBe(true);
    expect(recovered.result.status).toBe("fulfilled");
  });

  it("keeps legacy successful-response rejection recovery credential-free while still pending", async () => {
    const { calls, dir } = setup();
    await startLinkPurchase(input);
    const path = `${dir}/tixbit/link/${reference}.json`;
    const saved = JSON.parse(readFileSync(path, "utf8"));
    saved.paymentAttempted = true;
    saved.result = { success: false, status: "rejected", orderReference: reference,
      amountCents: 201, error: { code: "HTTP_200", message: "Invalid response" } };
    writeFileSync(path, JSON.stringify(saved));
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
      return calls.length === 2
        ? Response.json({ status: "payment_required", orderReference: reference }, { status: 402 })
        : Response.json({ success: true, status: "fulfilled", orderReference: reference });
    }) as typeof fetch;
    expect((await completeLinkPurchase(reference)).status).toBe("pending");
    const pending = JSON.parse(readFileSync(path, "utf8"));
    expect(pending.result.status).toBe("pending");
    expect(pending.paymentAttempted).toBe(true);
    expect((await completeLinkPurchase(reference)).status).toBe("fulfilled");
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.authorization).toBeNull();
      expect(call.body).toEqual(JSON.parse(saved.requestBody));
    }
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("does not reopen a previously cached 4xx rejection", async () => {
    const { calls, dir } = setup();
    await startLinkPurchase(input);
    const path = `${dir}/tixbit/link/${reference}.json`;
    const saved = JSON.parse(readFileSync(path, "utf8"));
    saved.paymentAttempted = true;
    saved.result = { success: false, status: "rejected", orderReference: reference,
      amountCents: 201, error: { code: "HTTP_409", message: "Rejected" } };
    writeFileSync(path, JSON.stringify(saved));
    expect(await completeLinkPurchase(reference)).toEqual(saved.result);
    expect(calls).toHaveLength(1);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an initial response for another order without caching it as terminal", async () => {
    const { calls, dir } = setup("approved", 200, false, "fulfilled", () => Response.json({
      success: false, status: "rejected", orderReference: "TBM-B23456789C",
    }, { status: 409 }));
    await startLinkPurchase(input);
    await expect(completeLinkPurchase(reference)).rejects.toMatchObject({ code: "ORDER_REFERENCE_CHANGED" });
    const saved = JSON.parse(readFileSync(`${dir}/tixbit/link/${reference}.json`, "utf8"));
    expect(saved.paymentAttempted).toBe(true);
    expect(saved.result).toBeUndefined();
    expect((await completeLinkPurchase(reference)).status).toBe("fulfilled");
    expect(calls.filter(call => call.authorization)).toHaveLength(1);
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

  it("keeps known paid manual review until fulfillment is confirmed for the same order", async () => {
    const { calls, dir } = setup("approved", 501);
    await startLinkPurchase(input);
    const manualReview = await completeLinkPurchase(reference);
    expect(manualReview.status).toBe("manual_review_required");
    let recovered = false;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
      return Response.json({ success: true, status: "fulfilled", ...(recovered ? { orderReference: reference } : {}) });
    }) as typeof fetch;
    expect(await completeLinkPurchase(reference)).toEqual(manualReview);
    const path = `${dir}/tixbit/link/${reference}.json`;
    expect(JSON.parse(readFileSync(path, "utf8")).result.status).toBe("manual_review_required");
    recovered = true;
    const fulfilled = await completeLinkPurchase(reference);
    expect(fulfilled).toMatchObject({ success: true, status: "fulfilled", orderReference: reference });
    expect(JSON.parse(readFileSync(path, "utf8")).result.status).toBe("fulfilled");
    expect(await completeLinkPurchase(reference)).toEqual(fulfilled);
    expect(calls).toHaveLength(5);
    expect(calls.filter(call => call.authorization)).toHaveLength(1);
    for (const call of calls.slice(3)) {
      expect(call.authorization).toBeNull();
      expect(call.body).toEqual(calls[0].body);
    }
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
