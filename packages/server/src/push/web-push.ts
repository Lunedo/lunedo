import { createCipheriv, createECDH, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { importJWK, SignJWT } from "jose";

const RECORD_SIZE = 4096;
const KEY_LENGTH = 65;
const AUTH_LENGTH = 16;
const VAPID_LIFETIME_SECONDS = 12 * 60 * 60;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushKeys {
  p256dh: string;
  auth: string;
}

export class PushKeyError extends Error {
  override name = "PushKeyError";
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function decode(value: string, length: number, name: string): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value.replace(/=+$/, "")) {
    throw new PushKeyError(`The ${name} key has the wrong format`);
  }
  return bytes;
}

export function parsePushKeys(keys: PushKeys): { publicKey: Buffer; auth: Buffer } {
  const publicKey = decode(keys.p256dh, KEY_LENGTH, "p256dh");
  if (publicKey[0] !== 0x04) throw new PushKeyError("The p256dh key is not an uncompressed P-256 point");
  try {
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(publicKey);
  } catch {
    throw new PushKeyError("The p256dh key is not a point on P-256");
  }
  return { publicKey, auth: decode(keys.auth, AUTH_LENGTH, "auth") };
}

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-KEY_LENGTH);
  if (!jwk.d) throw new Error("The generated key has no private part");
  return { publicKey: raw.toString("base64url"), privateKey: jwk.d };
}

export function encryptPushPayload(
  payload: Buffer,
  keys: PushKeys,
  fixed: { salt?: Buffer; senderPrivateKey?: Buffer } = {},
): Buffer {
  const receiver = parsePushKeys(keys);
  const sender = createECDH("prime256v1");
  if (fixed.senderPrivateKey) sender.setPrivateKey(fixed.senderPrivateKey);
  else sender.generateKeys();
  const senderPublicKey = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(receiver.publicKey);
  const salt = fixed.salt ?? randomBytes(16);

  const keyPrk = hmac(receiver.auth, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "latin1"),
    receiver.publicKey,
    senderPublicKey,
    Buffer.from([1]),
  ]);
  const inputKey = hmac(keyPrk, keyInfo);
  const prk = hmac(salt, inputKey);
  const contentKey = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "latin1")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "latin1")).subarray(0, 12);

  const plaintext = Buffer.concat([payload, Buffer.from([2])]);
  if (plaintext.length + 16 + 86 > RECORD_SIZE) throw new RangeError("The push payload is too large");
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublicKey.length, 20);
  return Buffer.concat([header, senderPublicKey, ciphertext]);
}

export async function vapidAuthorization(
  endpoint: URL,
  keys: VapidKeys,
  subject: string,
  now: Date = new Date(),
): Promise<string> {
  const publicKey = decode(keys.publicKey, KEY_LENGTH, "VAPID public");
  const key = await importJWK(
    {
      kty: "EC",
      crv: "P-256",
      x: publicKey.subarray(1, 33).toString("base64url"),
      y: publicKey.subarray(33).toString("base64url"),
      d: keys.privateKey,
    },
    "ES256",
  );
  const issuedAt = Math.floor(now.getTime() / 1000);
  const token = await new SignJWT({ sub: subject })
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(endpoint.origin)
    .setExpirationTime(issuedAt + VAPID_LIFETIME_SECONDS)
    .sign(key);
  return `vapid t=${token}, k=${keys.publicKey}`;
}
