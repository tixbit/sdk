import { Challenge, Credential, Method, Receipt, z } from "mppx";
import { Mppx } from "mppx/client";
import { assertMppChallenge } from "../src/safety.js";
import { describe, expect, it, vi } from "vitest";

const sandboxCharge = Method.from({
  name: "tixbit-sandbox",
  intent: "charge",
  schema: {
    credential: { payload: z.object({ authorization: z.literal("approved") }) },
    request: z.object({
      amount: z.string(),
      currency: z.literal("USD"),
      email: z.string(),
      idempotencyKey: z.string(),
      listingId: z.string(),
      quantity: z.number(),
    }),
  },
});

const sandboxClient = Method.toClient(sandboxCharge, {
  async createCredential({ challenge }) {
    return Credential.serialize({
      challenge,
      payload: { authorization: "approved" },
    });
  },
});

describe("official mppx deterministic protocol harness", () => {
  it.each([2499, 2500])("enforces the cap before credential creation (%i cents)", async (cap) => {
    const method = Method.from({ name: "tempo", intent: "charge", schema: {
      credential: { payload: z.object({ approved: z.boolean() }) },
      request: z.object({ amount: z.string(), currency: z.string() }),
    } });
    const createCredential = vi.fn(async ({ challenge }: { challenge: Challenge.Challenge }) => Credential.serialize({ challenge, payload: { approved: true } }));
    const challenge = Challenge.from({ id: "cap-fixture", realm: "mcp.tixbit.com", method: "tempo", intent: "charge", request: { amount: "25000000", currency: "0x20c0000000000000000000000000000000000000" } });
    const rawFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 402, headers: { "WWW-Authenticate": Challenge.serialize(challenge) } })).mockResolvedValueOnce(Response.json({ success: true }));
    const payments = Mppx.create({ fetch: rawFetch, methods: [Method.toClient(method, { createCredential })], polyfill: false, maxPaymentRetries: 1, onChallenge: async (received) => { assertMppChallenge(received, cap); return undefined; } });
    if (cap < 2500) {
      await expect(payments.fetch("https://mcp.tixbit.com/api/purchase")).rejects.toThrow();
      expect(createCredential).not.toHaveBeenCalled();
      expect(rawFetch).toHaveBeenCalledTimes(1);
    } else {
      await expect(payments.fetch("https://mcp.tixbit.com/api/purchase")).resolves.toHaveProperty("status", 200);
      expect(createCredential).toHaveBeenCalledTimes(1);
      expect(rawFetch).toHaveBeenCalledTimes(2);
    }
  });
  it("handles 402, authorized retry, server-authoritative amount, and receipt", async () => {
    const request = {
      amount: "275.00",
      currency: "USD" as const,
      email: "fan@example.com",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      listingId: "LISTING123",
      quantity: 2,
    };
    const rawFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (!authorization) {
        const challenge = Challenge.from({
          id: "sandbox-challenge-1",
          realm: "mcp.tixbit.test",
          method: sandboxCharge.name,
          intent: sandboxCharge.intent,
          expires: new Date(Date.now() + 60_000).toISOString(),
          request,
        });
        return new Response(null, {
          status: 402,
          headers: { "WWW-Authenticate": Challenge.serialize(challenge) },
        });
      }

      const credential = Credential.deserialize(authorization);
      expect(credential.challenge.request).toEqual(request);
      expect(credential.payload).toEqual({ authorization: "approved" });
      const body = JSON.parse(String(init?.body)) as { amount?: string };
      expect(body.amount).toBe("0.01");

      return Response.json(
        { success: true, status: "fulfilled", orderReference: "TBM-A23456789B" },
        {
          headers: {
            "Payment-Receipt": Receipt.serialize(
              Receipt.from({
                method: sandboxCharge.name,
                reference: "sandbox-receipt-1",
                status: "success",
                timestamp: "2026-08-08T12:00:00.000Z",
              }),
            ),
          },
        },
      );
    });
    const payments = Mppx.create({
      fetch: rawFetch,
      methods: [sandboxClient],
      polyfill: false,
    });

    const response = await payments.fetch("https://mcp.tixbit.test/api/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, amount: "0.01" }),
    });

    expect(response.status).toBe(200);
    expect(rawFetch).toHaveBeenCalledTimes(2);
    expect(Receipt.fromResponse(response)).toMatchObject({
      reference: "sandbox-receipt-1",
      status: "success",
    });
  });

  it("rejects an expired challenge before creating or retrying a credential", async () => {
    const createCredential = vi.fn(sandboxClient.createCredential);
    const client = Method.toClient(sandboxCharge, { createCredential });
    const challenge = Challenge.from({
      id: "sandbox-expired-1",
      realm: "mcp.tixbit.test",
      method: sandboxCharge.name,
      intent: sandboxCharge.intent,
      expires: new Date(Date.now() - 60_000).toISOString(),
      request: {
        amount: "275.00",
        currency: "USD",
        email: "fan@example.com",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        listingId: "LISTING123",
        quantity: 2,
      },
    });
    const rawFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 402,
        headers: { "WWW-Authenticate": Challenge.serialize(challenge) },
      }),
    );
    const payments = Mppx.create({
      fetch: rawFetch,
      methods: [client],
      polyfill: false,
    });

    await expect(payments.fetch("https://mcp.tixbit.test/api/purchase")).rejects.toThrow(
      /expired/i,
    );
    expect(rawFetch).toHaveBeenCalledTimes(1);
    expect(createCredential).not.toHaveBeenCalled();
  });
});
