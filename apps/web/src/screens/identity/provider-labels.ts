import type { BadgeVariant } from "@lunedo/ui";
import type { TFunction } from "i18next";
import type { IdentityProvider, ProviderPreset, ProviderType } from "../../api/identity-queries.js";
import type { Formatter } from "../../format/format.js";
import { translateKey } from "../../i18n/translate.js";

export function presetLabel(t: TFunction, type: ProviderType, preset: ProviderPreset): string {
  return translateKey(t, `identityProviders.presets.${type}.${preset}`);
}

export function providerPresetLabel(
  t: TFunction,
  provider: { type: ProviderType; config: { preset: ProviderPreset } },
): string {
  return presetLabel(t, provider.type, provider.config.preset);
}

export function typeLabel(t: TFunction, type: ProviderType): string {
  return t(`identityProviders.types.${type}`);
}

export function newestCredential(provider: Pick<IdentityProvider, "credentials">) {
  return [...provider.credentials].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function expiringCredentialsOf(provider: Pick<IdentityProvider, "expiringCredentials">) {
  return provider.expiringCredentials
    .filter((entry) => entry.purpose !== "caCertificate")
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

export function credentialStatus(
  t: TFunction,
  format: Formatter,
  provider: Pick<IdentityProvider, "credentials" | "warnings" | "expiringCredentials">,
): { variant: BadgeVariant; label: string } {
  const newest = newestCredential(provider);
  if (provider.warnings.includes("noCredential") || !newest) {
    return { variant: "danger", label: t("identityProviders.credentialStatus.none") };
  }
  if (provider.warnings.includes("credentialExpired")) {
    return { variant: "danger", label: t("identityProviders.credentialStatus.expired") };
  }
  const expiring = expiringCredentialsOf(provider)[0];
  if (provider.warnings.includes("credentialExpiring") && expiring) {
    return {
      variant: "warning",
      label: t("identityProviders.credentialStatus.expiring", {
        date: format.date(expiring.expiresAt),
        purpose: expiring.purpose,
      }),
    };
  }
  if (newest.expiresAt) {
    return {
      variant: "neutral",
      label: t("identityProviders.credentialStatus.validUntil", { date: format.date(newest.expiresAt) }),
    };
  }
  return { variant: "neutral", label: t("identityProviders.credentialStatus.noExpiry") };
}
