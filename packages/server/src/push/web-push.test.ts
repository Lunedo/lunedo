import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  encryptPushPayload,
  generateVapidKeys,
  PushKeyError,
  parsePushKeys,
  vapidAuthorization,
} from "./web-push.js";

const b64 = (value: string) => Buffer.from(value, "base64url");

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function decrypt(body: Buffer, receiverPrivateKey: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const senderPublicKey = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);
  const receiver = createECDH("prime256v1");
  receiver.setPrivateKey(receiverPrivateKey);
  const shared = receiver.computeSecret(senderPublicKey);
  const keyPrk = hmac(auth, shared);
  const inputKey = hmac(
    keyPrk,
    Buffer.concat([
      Buffer.from("WebPush: info\0", "latin1"),
      receiver.getPublicKey(),
      senderPublicKey,
      Buffer.from([1]),
    ]),
  );
  const prk = hmac(salt, inputKey);
  const key = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "latin1")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "latin1")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  expect(plain.at(-1)).toBe(2);
  return plain.subarray(0, -1).toString("utf8");
}

function browserKeys() {
  const receiver = createECDH("prime256v1");
  receiver.generateKeys();
  const auth = randomBytes(16);
  return {
    privateKey: receiver.getPrivateKey(),
    auth,
    keys: { p256dh: receiver.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
  };
}

describe("encryptPushPayload", () => {
  it("matches the example of RFC 8291", () => {
    const body = encryptPushPayload(
      Buffer.from("When I grow up, I want to be a watermelon"),
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
        senderPrivateKey: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
      },
    );
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("can be decrypted by the browser and uses a new key and salt each time", () => {
    const browser = browserKeys();
    const first = encryptPushPayload(Buffer.from('{"title":"Ä"}'), browser.keys);
    const second = encryptPushPayload(Buffer.from('{"title":"Ä"}'), browser.keys);
    expect(decrypt(first, browser.privateKey, browser.auth)).toBe('{"title":"Ä"}');
    expect(first.subarray(0, 16).equals(second.subarray(0, 16))).toBe(false);
    expect(first.subarray(21, 86).equals(second.subarray(21, 86))).toBe(false);
  });

  it("refuses payloads that do not fit into one record", () => {
    expect(() => encryptPushPayload(Buffer.alloc(4000), browserKeys().keys)).toThrow(RangeError);
  });
});

describe("parsePushKeys", () => {
  it.each([
    [
      "a short key",
      { p256dh: randomBytes(33).toString("base64url"), auth: randomBytes(16).toString("base64url") },
    ],
    [
      "a point off the curve",
      {
        p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    ],
    [
      "a short auth secret",
      { p256dh: browserKeys().keys.p256dh, auth: randomBytes(8).toString("base64url") },
    ],
    [
      "characters outside base64url",
      { p256dh: `${browserKeys().keys.p256dh.slice(0, -1)}+`, auth: randomBytes(16).toString("base64url") },
    ],
  ])("rejects %s", (_name, keys) => {
    expect(() => parsePushKeys(keys)).toThrow(PushKeyError);
  });
});

describe("vapidAuthorization", () => {
  it("signs a token for the origin of the push service with the instance key", async () => {
    const keys = generateVapidKeys();
    const now = new Date("2026-10-15T10:00:00Z");
    const header = await vapidAuthorization(
      new URL("https://push.example.com/send/abc?x=1"),
      keys,
      "https://wiki.example.org",
      now,
    );
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match?.[2]).toBe(keys.publicKey);
    const token = match?.[1] ?? "";
    expect(decodeProtectedHeader(token)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(decodeJwt(token)).toEqual({
      aud: "https://push.example.com",
      sub: "https://wiki.example.org",
      exp: now.getTime() / 1000 + 12 * 3600,
    });
    const publicKey = b64(keys.publicKey);
    const verifyKey = await importJWK(
      {
        kty: "EC",
        crv: "P-256",
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33).toString("base64url"),
      },
      "ES256",
    );
    await expect(jwtVerify(token, verifyKey, { currentDate: now })).resolves.toBeDefined();
  });
});
