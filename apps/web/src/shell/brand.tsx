import { useTranslation } from "react-i18next";
import { LunedoMark } from "./lunedo-mark.js";

export interface BrandOrganization {
  id: string;
  name: string;
  logoRef: string;
}

export function organizationLogoUrl(organization: { id: string; logoRef: string }): string {
  return `/api/v1/organizations/${organization.id}/logo?v=${encodeURIComponent(organization.logoRef)}`;
}

export function BrandMark({ organization }: { organization: BrandOrganization | null }) {
  const { t } = useTranslation();
  if (organization) {
    return (
      <div className="flex items-center gap-3">
        <img
          src={organizationLogoUrl(organization)}
          alt={t("brand.organizationLogo", { name: organization.name })}
          className="h-12 w-auto max-w-full object-contain"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 font-semibold text-lg">
      <LunedoMark className="size-8" />
      <span>{t("brand.name")}</span>
    </div>
  );
}
