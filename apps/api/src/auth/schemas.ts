import { emailSchema, PASSWORD_MAX_LENGTH } from "@pagehall/server";
import { z } from "zod";

const base64url = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9_-]*$/);

const transports = z.array(z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"])).max(8);

const extensionResults = z
  .record(z.string().max(64), z.json())
  .refine((value) => JSON.stringify(value).length <= 4096);

/** A WebAuthn assertion as serialized by the browser, with limits on every field. */
export const authenticationResponseSchema = z
  .object({
    id: base64url(1024),
    rawId: base64url(1024),
    type: z.literal("public-key"),
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
    clientExtensionResults: extensionResults,
    response: z
      .object({
        clientDataJSON: base64url(4096),
        authenticatorData: base64url(4096),
        signature: base64url(1024),
        userHandle: base64url(256).optional(),
      })
      .strict(),
  })
  .strict();

/** A WebAuthn registration as serialized by the browser, with limits on every field. */
export const registrationResponseSchema = z
  .object({
    id: base64url(1024),
    rawId: base64url(1024),
    type: z.literal("public-key"),
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
    clientExtensionResults: extensionResults,
    response: z
      .object({
        clientDataJSON: base64url(4096),
        attestationObject: base64url(16_384),
        authenticatorData: base64url(4096).optional(),
        transports: transports.optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64url(2048).optional(),
      })
      .strict(),
  })
  .strict();

const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const totpCode = z.string().trim().max(16);
const recoveryCode = z.string().trim().max(64);
const token = z.string().max(128);

export const signInSchema = z.object({ email: z.string().trim().min(1).max(254), password }).strict();

export const secondFactorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("totp"), code: totpCode }).strict(),
  z.object({ type: z.literal("recoveryCode"), code: recoveryCode }).strict(),
  z.object({ type: z.literal("passkey"), response: authenticationResponseSchema }).strict(),
]);

export const passkeySignInSchema = z.object({ response: authenticationResponseSchema }).strict();

export const reauthenticationSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password }).strict(),
  z.object({ method: z.literal("totp"), code: totpCode }).strict(),
  z.object({ method: z.literal("passkey"), response: authenticationResponseSchema }).strict(),
]);

export const passwordResetRequestSchema = z.object({ email: z.string().trim().min(1).max(254) }).strict();
export const passwordResetSchema = z.object({ token, password }).strict();
export const tokenSchema = z.object({ token }).strict();
export const newPasswordSchema = z.object({ password }).strict();
export const newEmailSchema = z.object({ email: emailSchema }).strict();
export const totpConfirmationSchema = z.object({ code: totpCode }).strict();
export const passkeyRegistrationSchema = z
  .object({ response: registrationResponseSchema, name: z.string().trim().min(1).max(100) })
  .strict();
export const idSchema = z.uuid();
export const emptySchema = z.object({}).strict().optional();
