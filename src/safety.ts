/** Parse a positive total USD ceiling without rounding fractional cents. */
export function usdCents(raw: string | undefined): number {
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw)) throw new TypeError("--max-price must be a positive total USD amount with at most two decimals");
  const [dollars, cents = ""] = raw.split(".");
  const amount = BigInt(dollars!) * 100n + BigInt(cents.padEnd(2, "0"));
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Invalid --max-price");
  return Number(amount);
}

export function positiveInteger(raw: string, name: string, max: number): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`${name} must be an integer from 1 to ${max}`);
  return value;
}

/** Credential-bearing web requests only go to the canonical app or local QA. */
export function trustedWebBase(base: string): string {
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.origin === "https://www.tixbit.com" || (local && ["http:", "https:"].includes(url.protocol)))) {
    throw new TypeError("Credential requests require https://www.tixbit.com or a loopback QA origin");
  }
  return url.origin;
}

/** Run in mppx onChallenge, before signing or transferring any funds.
 * pathUSD uses six atomic decimals. Unknown tokens and recurring intents fail closed.
 */
export function assertMppChallenge(challenge: { method: string; intent: string; request: Record<string, unknown> }, maxAmountCents: number): void {
  const { amount, currency } = challenge.request;
  if (!Number.isSafeInteger(maxAmountCents) || maxAmountCents <= 0 ||
      challenge.method !== "tempo" || challenge.intent !== "charge" ||
      currency !== "0x20c0000000000000000000000000000000000000" ||
      typeof amount !== "string" || !/^\d{1,30}$/.test(amount) ||
      BigInt(amount) <= 0n || BigInt(amount) > BigInt(maxAmountCents) * 10000n ||
      challenge.request.splits !== undefined ||
      (challenge.request.methodDetails !== undefined &&
       (!challenge.request.methodDetails || typeof challenge.request.methodDetails !== "object" ||
        "splits" in challenge.request.methodDetails))) {
    throw new TypeError("MPP challenge exceeds the approved total or uses an unsupported payment asset or intent");
  }
}

/** Redact credential fields and known injected values, including reflected errors. */
export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    let result = value.replace(/\bspt_[A-Za-z0-9_]+/g, "[REDACTED]");
    for (const secret of secrets.filter(Boolean)) result = result.split(secret).join("[REDACTED]");
    return result;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|authorization|private.?key|password|credential/i.test(key) ? "[REDACTED]" : redact(item, secrets)]));
  return value;
}
