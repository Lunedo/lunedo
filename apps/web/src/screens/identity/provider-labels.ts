import type { BadgeVariant } from "@pagehall/ui";
import type { TFunction } from "i18next";
import type { IdentityProvider, ProviderPreset } from "../../api/identity-queries.js";
import type { Formatter } from "../../format/format.js";

export function presetLabel(t: TFunction, preset: ProviderPreset): string {
  return t(`identityProviders.presets.${preset}`);
}

export function newestCredential(provider: Pick<IdentityProvider, "credentials">) {
  return [...provider.credentials].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function credentialStatus(
  t: TFunction,
  format: Formatter,
  provider: Pick<IdentityProvider, "credentials" | "warnings">,
): { variant: BadgeVariant; label: string } {
  const newest = newestCredential(provider);
  if (provider.warnings.includes("noCredential") || !newest) {
    return { variant: "danger", label: t("identityProviders.credentialStatus.none") };
  }
  if (provider.warnings.includes("credentialExpired")) {
    return { variant: "danger", label: t("identityProviders.credentialStatus.expired") };
  }
  if (provider.warnings.includes("credentialExpiring") && newest.expiresAt) {
    return {
      variant: "warning",
      label: t("identityProviders.credentialStatus.expiring", { date: format.date(newest.expiresAt) }),
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
