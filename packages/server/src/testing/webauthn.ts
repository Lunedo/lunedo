import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

function sha256(data: Buffer | string): Buffer {
  return createHash("sha256").update(data).digest();
}

function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);
  return bytes;
}

export class VirtualAuthenticator {
  readonly credentialId = randomBytes(16);
  readonly #privateKey: KeyObject;
  readonly #publicKey: KeyObject;
  #counter = 0;
  #userHandle: string | undefined;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
  }

  #cosePublicKey(): Uint8Array {
    const jwk = this.#publicKey.export({ format: "jwk" });
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x ?? "", "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y ?? "", "base64url"))],
      ]),
    );
  }

  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    origin: string,
    settings: { userVerified?: boolean } = {},
  ): RegistrationResponseJSON {
    this.#userHandle = options.user.id;
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const flags =
      FLAG_USER_PRESENT | FLAG_ATTESTED_DATA | (settings.userVerified === false ? 0 : FLAG_USER_VERIFIED);
    const authData = Buffer.concat([
      sha256(options.rp.id ?? new URL(origin).hostname),
      Buffer.from([flags]),
      counterBytes(this.#counter),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      Buffer.from(this.#cosePublicKey()),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, string> | Uint8Array>([
        ["fmt", "none"],
        ["attStmt", new Map<string, string>()],
        ["authData", new Uint8Array(authData)],
      ]),
    );
    const id = this.credentialId.toString("base64url");
    return {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal"],
      },
    };
  }

  assert(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
    settings: { userVerified?: boolean; rpId?: string } = {},
  ): AuthenticationResponseJSON {
    this.#counter += 1;
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }),
    );
    const flags = FLAG_USER_PRESENT | (settings.userVerified === false ? 0 : FLAG_USER_VERIFIED);
    const authenticatorData = Buffer.concat([
      sha256(settings.rpId ?? options.rpId ?? new URL(origin).hostname),
      Buffer.from([flags]),
      counterBytes(this.#counter),
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      this.#privateKey,
    );
    const id = this.credentialId.toString("base64url");
    return {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
        ...(this.#userHandle ? { userHandle: this.#userHandle } : {}),
      },
    };
  }
}
