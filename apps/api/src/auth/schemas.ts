import {
  emailSchema,
  idSchema,
  linkTokenSchema,
  passkeyNameSchema,
  passwordSchema,
  recoveryCodeSchema,
  signInEmailSchema,
  totpCodeSchema,
} from "@pagehall/shared";
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

const password = passwordSchema;
const totpCode = totpCodeSchema;
const recoveryCode = recoveryCodeSchema;
const token = linkTokenSchema;

export const signInSchema = z.object({ email: signInEmailSchema, password }).strict();

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

export const passwordResetRequestSchema = z.object({ email: signInEmailSchema }).strict();
export const passwordResetSchema = z.object({ token, password }).strict();
export const tokenSchema = z.object({ token }).strict();
export const newPasswordSchema = z.object({ password }).strict();
export const newEmailSchema = z.object({ email: emailSchema }).strict();
export const totpConfirmationSchema = z.object({ code: totpCode }).strict();
export const passkeyRegistrationSchema = z
  .object({ response: registrationResponseSchema, name: passkeyNameSchema })
  .strict();
export { idSchema };
export const emptySchema = z.object({}).strict().optional();

const descriptor = z.object({
  id: z.string(),
  type: z.string(),
  transports: z.array(z.string()).optional(),
});
const extensions = z.record(z.string(), z.json());

export const requestOptionsSchema = z.object({
  challenge: z.string(),
  timeout: z.number().optional(),
  rpId: z.string().optional(),
  allowCredentials: z.array(descriptor).optional(),
  userVerification: z.string().optional(),
  hints: z.array(z.string()).optional(),
  extensions: extensions.optional(),
});

export const creationOptionsSchema = z.object({
  rp: z.object({ name: z.string(), id: z.string().optional() }),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  challenge: z.string(),
  pubKeyCredParams: z.array(z.object({ alg: z.number(), type: z.string() })),
  timeout: z.number().optional(),
  excludeCredentials: z.array(descriptor).optional(),
  authenticatorSelection: z
    .object({
      authenticatorAttachment: z.string().optional(),
      requireResidentKey: z.boolean().optional(),
      residentKey: z.string().optional(),
      userVerification: z.string().optional(),
    })
    .optional(),
  hints: z.array(z.string()).optional(),
  attestation: z.string().optional(),
  attestationFormats: z.array(z.string()).optional(),
  extensions: extensions.optional(),
});

const sessionAccount = z
  .object({
    id: idSchema,
    email: z.string().nullable(),
    name: z.string(),
    type: z.enum(["standard", "guest", "portal", "service"]).describe("Kind of account."),
    homeOrganizationId: idSchema.nullable().describe("Organization the account belongs to, or null."),
  })
  .nullable();

export const signedInSchema = z.object({
  status: z.literal("signedIn"),
  sessionKind: z.string(),
  account: sessionAccount,
});

export const signInResultSchema = z.union([
  signedInSchema,
  z.object({ status: z.literal("secondFactorRequired"), factors: z.array(z.string()) }),
]);

export const sessionInfoSchema = z.object({
  sessionKind: z.string(),
  account: sessionAccount,
  methods: z.array(z.string()),
  recentlyAuthenticated: z.boolean(),
});

const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  deviceType: z.string(),
  backedUp: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});

export const securityOverviewSchema = z.object({
  totp: z.boolean(),
  passkeys: z.array(passkeySchema),
  recoveryCodes: z.number().int(),
  secondFactorRequired: z.boolean(),
});

export const totpSetupSchema = z.object({ secret: z.string(), uri: z.string() });
export const recoveryCodesSchema = z.object({ recoveryCodes: z.array(z.string()).nullable() });
export const passkeyAddedSchema = recoveryCodesSchema.extend({ passkey: passkeySchema });

export const accountSessionSchema = z.object({
  id: idSchema,
  current: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  clientIp: z.string().nullable(),
  browser: z.string().nullable(),
  operatingSystem: z.string().nullable(),
  methods: z.array(z.string()),
});

export const endedSchema = z.object({ ended: z.number().int() });
export const idParams = z.object({ id: idSchema }).strict();
