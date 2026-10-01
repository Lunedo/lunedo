import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import type { Database, Executor } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { webauthnCredentials } from "./schema.js";

export type { AuthenticationResponseJSON, RegistrationResponseJSON };

const TIMEOUT_MS = 5 * 60 * 1000;

export class RelyingPartyError extends Error {
  override name = "RelyingPartyError";

  constructor() {
    super("Passkeys need the instance URL; it is not configured yet");
  }
}

export interface RelyingParty {
  id: string;
  origin: string;
  name: string;
}

export interface Passkey {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface VerifiedAssertion {
  accountId: string;
  credentialId: string;
  userVerified: boolean;
}

function uuidBytes(id: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(id.replaceAll("-", ""), "hex"));
}

/**
 * WebAuthn passkeys and hardware security keys through SimpleWebAuthn. The relying party ID is
 * the host name of the instance URL. Challenges are kept by the caller in `ChallengeStore`.
 */
export class WebAuthnService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #clock: () => Date;

  constructor(options: { database: Database; settings: SettingsService; clock?: () => Date }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#clock = options.clock ?? (() => new Date());
  }

  async relyingParty(): Promise<RelyingParty> {
    const url = await this.#settings.get(instanceUrlSetting, {});
    if (!url) throw new RelyingPartyError();
    const name = await this.#settings.get(instanceNameSetting, {});
    return { id: new URL(url).hostname, origin: url, name };
  }

  async registrationOptions(account: {
    id: string;
    email: string;
    name: string;
  }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const rp = await this.relyingParty();
    const existing = await this.#database
      .select({ credentialId: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.accountId, account.id));
    return generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userName: account.email,
      userDisplayName: account.name,
      userID: uuidBytes(account.id),
      timeout: TIMEOUT_MS,
      attestationType: "none",
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
  }

  /** Verifies a registration and stores the credential. Returns null when it is not valid. */
  async register(
    executor: Executor,
    options: {
      accountId: string;
      response: RegistrationResponseJSON;
      expectedChallenge: string;
      name: string;
    },
  ): Promise<Passkey | null> {
    const rp = await this.relyingParty();
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: options.response,
        expectedChallenge: options.expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: false,
      });
    } catch {
      return null;
    }
    if (!verification.verified) return null;
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const [row] = await executor
      .insert(webauthnCredentials)
      .values({
        accountId: options.accountId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        signCount: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: options.name,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      deviceType: row.deviceType,
      backedUp: row.backedUp,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    };
  }

  /**
   * Options for an assertion. With an account, only its credentials are allowed; without one,
   * the browser offers the passkeys it has for this instance.
   */
  async authenticationOptions(options: {
    accountId?: string;
    userVerification: "required" | "preferred";
  }): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const rp = await this.relyingParty();
    const allowCredentials = options.accountId
      ? (
          await this.#database
            .select({ id: webauthnCredentials.credentialId, transports: webauthnCredentials.transports })
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.accountId, options.accountId))
        ).map((credential) => ({ id: credential.id, transports: credential.transports }))
      : undefined;
    return generateAuthenticationOptions({
      rpID: rp.id,
      timeout: TIMEOUT_MS,
      userVerification: options.userVerification,
      ...(allowCredentials ? { allowCredentials } : {}),
    });
  }

  /**
   * Verifies an assertion against the stored credential and updates its counter. With
   * `accountId`, the credential must belong to that account. Returns null when it is not valid.
   */
  async verify(options: {
    response: AuthenticationResponseJSON;
    expectedChallenge: string;
    accountId?: string;
    requireUserVerification: boolean;
  }): Promise<VerifiedAssertion | null> {
    const rp = await this.relyingParty();
    const [stored] = await this.#database
      .select()
      .from(webauthnCredentials)
      .where(
        and(
          eq(webauthnCredentials.credentialId, options.response.id),
          options.accountId ? eq(webauthnCredentials.accountId, options.accountId) : undefined,
        ),
      );
    if (!stored) return null;
    const userHandle = options.response.response.userHandle;
    if (userHandle && userHandle !== Buffer.from(uuidBytes(stored.accountId)).toString("base64url"))
      return null;
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: options.response,
        expectedChallenge: options.expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        requireUserVerification: options.requireUserVerification,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: stored.signCount,
          transports: stored.transports,
        },
      });
    } catch {
      return null;
    }
    if (!verification.verified) return null;
    await this.#database
      .update(webauthnCredentials)
      .set({
        signCount: verification.authenticationInfo.newCounter,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        lastUsedAt: this.#clock(),
      })
      .where(eq(webauthnCredentials.id, stored.id));
    return {
      accountId: stored.accountId,
      credentialId: stored.id,
      userVerified: verification.authenticationInfo.userVerified,
    };
  }

  async list(accountId: string): Promise<Passkey[]> {
    return this.#database
      .select({
        id: webauthnCredentials.id,
        name: webauthnCredentials.name,
        deviceType: webauthnCredentials.deviceType,
        backedUp: webauthnCredentials.backedUp,
        createdAt: webauthnCredentials.createdAt,
        lastUsedAt: webauthnCredentials.lastUsedAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.accountId, accountId))
      .orderBy(webauthnCredentials.createdAt);
  }

  /** Removes a passkey of the account; returns its name, or null when it does not exist. */
  async remove(executor: Executor, accountId: string, id: string): Promise<string | null> {
    const [deleted] = await executor
      .delete(webauthnCredentials)
      .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.accountId, accountId)))
      .returning({ name: webauthnCredentials.name });
    return deleted?.name ?? null;
  }
}
