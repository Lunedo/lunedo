const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function format(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[bytes[i] ?? 0];
  }
  return out;
}

let lastTimestamp = 0;
let lastRandom: Uint8Array = new Uint8Array(10);

/**
 * Generates a UUIDv7 (RFC 9562): 48-bit Unix milliseconds, version and variant bits,
 * random bits otherwise. IDs created in the same millisecond by this process are
 * monotonic, so primary keys stay ordered by creation time within a node.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  let timestamp = now;
  let random: Uint8Array;

  if (timestamp <= lastTimestamp) {
    timestamp = lastTimestamp;
    random = increment(lastRandom);
    if (random.every((byte) => byte === 0)) {
      timestamp += 1;
      random = crypto.getRandomValues(new Uint8Array(10));
    }
  } else {
    random = crypto.getRandomValues(new Uint8Array(10));
  }
  lastTimestamp = timestamp;
  lastRandom = random;

  for (let i = 5; i >= 0; i--) {
    bytes[i] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes.set(random, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  return format(bytes);
}

function increment(value: Uint8Array): Uint8Array {
  const next = new Uint8Array(value);
  for (let i = next.length - 1; i >= 0; i--) {
    const byte = next[i] ?? 0;
    if (byte < 255) {
      next[i] = byte + 1;
      return next;
    }
    next[i] = 0;
  }
  return next;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Milliseconds since the Unix epoch encoded in a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  return Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}
