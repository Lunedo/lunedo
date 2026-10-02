import { z } from "zod";

export const idSchema = z.uuid().toLowerCase();

export const supportedLanguages = ["en", "de"] as const;
export type Language = (typeof supportedLanguages)[number];
export const languageSchema = z.enum(supportedLanguages);

export const PASSWORD_MAX_LENGTH = 256;
export const PASSWORD_MIN_LENGTH_FLOOR = 8;

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const emailSchema = z.email().max(254);
export const signInEmailSchema = z.string().trim().min(1).max(254);
export const accountNameSchema = z.string().trim().min(1).max(200);
export const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);
export const totpCodeSchema = z.string().trim().max(16);
export const recoveryCodeSchema = z.string().trim().max(64);
export const linkTokenSchema = z.string().max(128);
export const setupCodeSchema = z.string().trim().min(1).max(64);
export const passkeyNameSchema = z.string().trim().min(1).max(100);

export const timeZoneSchema = z.string().refine(isTimeZone, "must be an IANA time zone");

export const instanceUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
    } catch {
      return false;
    }
  }, "must be an http or https origin without a path, for example https://wiki.example.org");
export const instanceNameSchema = z.string().trim().min(1).max(100);

export const organizationNameSchema = z.string().trim().min(1).max(100);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "must be lowercase letters, digits and hyphens");
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "must be a domain name");

export const groupNameSchema = z.string().trim().min(1).max(100);
export const groupDescriptionSchema = z.string().trim().max(1000);
export const roleNameSchema = z.string().trim().min(1).max(100);
export const tokenNameSchema = z.string().trim().min(1).max(100);
export const serviceAccountNameSchema = z.string().trim().min(1).max(200);
export const serviceAccountDescriptionSchema = z.string().trim().max(1000);
export const responsibleAccountIdsSchema = z.array(idSchema).max(20);
export const breakGlassReasonSchema = z.string().trim().min(10).max(2000);

export const smtpSecurityModes = ["tls", "starttls", "none"] as const;
export const smtpConfigurationSchema = z
  .object({
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    security: z.enum(smtpSecurityModes),
    username: z.string().min(1).max(256).nullable(),
    from: z.email().max(254),
  })
  .strict();
export type SmtpConfiguration = z.infer<typeof smtpConfigurationSchema>;
export const smtpPasswordSchema = z.string().max(1024).nullable();

export const accessLevels = ["view", "manage"] as const;
export type AccessLevel = (typeof accessLevels)[number];

export const instanceAreas = [
  "organizations",
  "accounts",
  "signInAndSecurity",
  "settings",
  "operations",
  "auditLog",
] as const;

export const organizationAreas = [
  "membersAndGroups",
  "spaces",
  "settings",
  "signInAndSecurity",
  "integrationsAndApi",
  "auditLog",
] as const;

export type InstanceArea = (typeof instanceAreas)[number];
export type OrganizationArea = (typeof organizationAreas)[number];
export type Area = InstanceArea | OrganizationArea;
export type Areas = Partial<Record<Area, AccessLevel>>;
export type RoleScope = "instance" | "organization";

export function areasOf(scope: RoleScope): readonly Area[] {
  return scope === "instance" ? instanceAreas : organizationAreas;
}

export function areasSchema(scope: RoleScope) {
  const shape = Object.fromEntries(areasOf(scope).map((area) => [area, z.enum(accessLevels).optional()]));
  return z.object(shape).strict() as unknown as z.ZodType<Areas>;
}

export const tokenScopesSchema = z
  .object({
    instance: areasSchema("instance").optional(),
    organization: areasSchema("organization").optional(),
  })
  .strict()
  .refine(
    (scopes) => Object.keys(scopes.instance ?? {}).length + Object.keys(scopes.organization ?? {}).length > 0,
    "A token needs at least one scope",
  );
