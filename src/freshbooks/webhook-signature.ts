import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * FreshBooks signs webhook payloads with HMAC-SHA256 (base64) using the
 * callback's `verifier` as the key. The docs serialize the fields like Python's
 * `json.dumps` (", " / ": " spacing) before signing — but the exact byte format
 * is fragile, so we compute several candidate serializations and accept a match
 * against any of them (and any of our stored verifiers).
 *
 * Pure + unit-tested. No I/O.
 */

const SIGNATURE_HEADER = 'x-freshbooks-hmac-sha256';

export { SIGNATURE_HEADER };

/** Python `json.dumps(dict)` default: {"k": "v", "k2": "v2"} (string values). */
function pythonJson(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(String(v))}`)
    .join(', ');
  return `{${body}}`;
}

/** Compact JSON: {"k":"v"} — fallback if FB ever drops the spacing. */
function compactJson(fields: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
  );
}

/** All strings we might have to HMAC, given the parsed fields + raw body. */
export function candidateMessages(
  fields: Record<string, string>,
  rawBody?: string,
): string[] {
  const messages = [pythonJson(fields), compactJson(fields)];
  if (rawBody) messages.push(rawBody);
  return messages;
}

function hmacBase64(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('base64');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * True if `headerSig` matches the HMAC of any candidate message under any of the
 * provided verifiers. (We don't know which callback fired, so we try all keys.)
 */
export function verifyFreshbooksSignature(
  verifiers: string[],
  fields: Record<string, string>,
  headerSig: string | undefined,
  rawBody?: string,
): boolean {
  if (!headerSig || verifiers.length === 0) return false;
  const messages = candidateMessages(fields, rawBody);
  for (const verifier of verifiers) {
    if (!verifier) continue;
    for (const message of messages) {
      if (safeEqual(hmacBase64(verifier, message), headerSig)) {
        return true;
      }
    }
  }
  return false;
}
