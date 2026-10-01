import { z } from "zod";
import {
  accountNameSchema,
  emailSchema,
  instanceNameSchema,
  instanceUrlSchema,
  languageSchema,
  organizationNameSchema,
  PASSWORD_MAX_LENGTH,
  slugSchema,
  smtpConfigurationSchema,
  smtpPasswordSchema,
  timeZoneSchema,
  totpCodeSchema,
} from "./validation.js";

const empty = z.object({}).strict();
const checkStatus = z.enum(["ok", "warning", "error"]);

export const setupOrganizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  language: languageSchema,
  timeZone: z.string(),
});

export const smtpInputSchema = smtpConfigurationSchema
  .extend({ password: smtpPasswordSchema.optional() })
  .strict();
export const smtpTestInputSchema = smtpInputSchema.extend({
  to: emailSchema,
  language: languageSchema.default("en"),
});
export const smtpTestResultSchema = z.object({
  delivered: z.boolean(),
  error: z.object({ code: z.string().nullable(), responseCode: z.number().int().nullable() }).nullable(),
});

export const setupStepSchemas = {
  systemCheck: {
    details: z.object({
      checks: z.object({
        database: z.object({
          status: checkStatus,
          version: z.string().nullable(),
          migrationsUpToDate: z.boolean(),
        }),
        clock: z.object({ status: checkStatus, offsetMs: z.number().nullable() }),
        fileStorage: z.object({
          status: checkStatus,
          writable: z.boolean(),
          freeBytes: z.number().nullable(),
        }),
        instanceUrl: z.object({ status: checkStatus, configured: z.boolean() }),
        https: z.object({ status: checkStatus, instanceUrl: z.boolean(), request: z.boolean() }),
      }),
    }),
    actions: { acknowledge: { input: empty, result: empty } },
  },
  instance: {
    details: z.object({ url: z.string(), name: z.string(), suggestedUrl: z.string().nullable() }),
    actions: {
      save: {
        input: z.object({ url: instanceUrlSchema, name: instanceNameSchema }).strict(),
        result: empty,
      },
    },
  },
  owner: {
    details: z.object({
      owner: z.object({ email: z.string().nullable(), name: z.string() }).nullable(),
      totpConfirmed: z.boolean(),
      passwordMaxLength: z.number().int(),
    }),
    actions: {
      createAccount: {
        input: z
          .object({
            email: emailSchema,
            name: accountNameSchema,
            password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
            language: languageSchema.optional(),
          })
          .strict(),
        result: empty,
      },
      beginTotp: { input: empty, result: z.object({ secret: z.string(), uri: z.string() }) },
      confirmTotp: {
        input: z.object({ code: totpCodeSchema }).strict(),
        result: z.object({ recoveryCodes: z.array(z.string()) }),
      },
    },
  },
  keyBackup: {
    details: z.object({ downloaded: z.boolean(), provider: z.string() }),
    actions: { download: { input: empty, result: z.string() }, confirm: { input: empty, result: empty } },
  },
  organization: {
    details: z.object({ organization: setupOrganizationSchema.nullable() }),
    actions: {
      save: {
        input: z
          .object({
            name: organizationNameSchema,
            slug: slugSchema.optional(),
            language: languageSchema,
            timeZone: timeZoneSchema,
          })
          .strict(),
        result: z.object({ organizationId: z.uuid() }),
      },
    },
  },
  mail: {
    details: z.object({ smtp: smtpConfigurationSchema.nullable(), passwordSet: z.boolean() }),
    actions: {
      save: { input: smtpInputSchema, result: empty },
      test: { input: smtpTestInputSchema, result: smtpTestResultSchema },
    },
  },
} as const;

export type SetupStepId = keyof typeof setupStepSchemas;
export const setupStepIds = Object.keys(setupStepSchemas) as SetupStepId[];
export type SetupStepDetails<S extends SetupStepId> = z.output<(typeof setupStepSchemas)[S]["details"]>;
export type SetupActionId<S extends SetupStepId> = keyof (typeof setupStepSchemas)[S]["actions"] & string;
type ActionOf<S extends SetupStepId, A extends SetupActionId<S>> = (typeof setupStepSchemas)[S]["actions"][A];
export type SetupActionInput<S extends SetupStepId, A extends SetupActionId<S>> =
  ActionOf<S, A> extends { input: z.ZodType } ? z.input<ActionOf<S, A>["input"]> : never;
export type SetupActionResult<S extends SetupStepId, A extends SetupActionId<S>> =
  ActionOf<S, A> extends { result: z.ZodType } ? z.output<ActionOf<S, A>["result"]> : never;

export const setupStepStateSchema = z.discriminatedUnion(
  "id",
  setupStepIds.map((id) =>
    z.object({
      id: z.literal(id),
      required: z.boolean(),
      completed: z.boolean(),
      details: setupStepSchemas[id].details,
    }),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
);
