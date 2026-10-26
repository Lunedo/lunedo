import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { instanceInfoQuery } from "../../api/queries.js";
import { setProblemOrganization } from "../../errors/problem-message.js";
import { isAccentColor } from "../../preferences/preferences.js";
import { setAccentColor } from "../../preferences/preferences-provider.js";
import { organizationLogoUrl } from "../../shell/brand.js";
import { LunedoMark } from "../../shell/lunedo-mark.js";
import { MaintenanceBanner } from "../../shell/maintenance-banner.js";
import { CornerControls } from "./corner-controls.js";

export function AuthLayout() {
  const { t } = useTranslation();
  const info = useQuery(instanceInfoQuery);
  const location = useLocation();
  const search: { redirect?: string } = useSearch({ strict: false });
  const accent = info.data?.organization?.accentColor ?? info.data?.accentColor;
  const organizationName = info.data?.organization?.name ?? info.data?.name ?? "";

  useEffect(() => {
    if (isAccentColor(accent)) setAccentColor(accent);
  }, [accent]);

  useEffect(() => {
    setProblemOrganization(organizationName);
  }, [organizationName]);

  const host = globalThis.location?.host ?? "";
  return (
    <div className="relative flex min-h-full flex-col bg-sidebar">
      <MaintenanceBanner />
      <div className="relative flex flex-1 flex-col">
        <CornerControls ownLanguage />
        <main className="flex flex-1 items-center justify-center px-4 pt-12 pb-10">
          <Outlet />
        </main>
        <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 pb-4 text-text-muted text-xs">
          {location.pathname === "/sign-in" ? (
            <>
              <Link
                to="/sign-in"
                search={{ ...(search.redirect ? { redirect: search.redirect } : {}), emergency: true }}
                className="inline-flex min-h-hit items-center rounded-sm hover:text-text hover:underline focus-visible:focus-ring"
              >
                {t("auth.emergency.footerLink")}
              </Link>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          {info.data?.name ? (
            <>
              <span>{info.data.name}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{host}</span>
        </footer>
      </div>
    </div>
  );
}

export function AuthBrand() {
  const { t } = useTranslation();
  const info = useQuery(instanceInfoQuery);
  const organization = info.data?.organization;
  const name = organization?.name ?? "";
  if (organization?.logoRef) {
    return (
      <div className="flex items-center gap-3">
        <img
          src={organizationLogoUrl({ id: organization.id, logoRef: organization.logoRef })}
          alt={t("brand.organizationLogo", { name })}
          className="h-control-lg w-auto max-w-field object-contain"
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold" title={name}>
            {name}
          </span>
          <span className="text-text-muted text-xs">{t("auth.brand.withLunedo")}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <LunedoMark className="h-control-md" />
      <span className="font-semibold">{t("brand.name")}</span>
      {name ? (
        <span className="truncate text-text-muted" title={name}>
          · {name}
        </span>
      ) : null}
    </div>
  );
}

export function AuthCard({
  title,
  description,
  banner,
  links,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  banner?: ReactNode;
  links?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`flex w-full flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card ${wide ? "max-w-card-wide" : "max-w-card"}`}
    >
      <AuthBrand />
      {banner}
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-heading">{title}</h1>
        {description ? <p className="text-text-muted">{description}</p> : null}
      </div>
      {children}
      {links ? <div className="flex flex-col items-center gap-2 text-sm">{links}</div> : null}
    </div>
  );
}

export const AUTH_LINK =
  "inline-flex min-h-hit items-center rounded-sm px-2 font-medium text-accent hover:underline focus-visible:focus-ring";

export function AuthLinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={AUTH_LINK}>
      {children}
    </button>
  );
}

export function OrDivider({ label, id }: { label: string; id?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-text-muted">
      <span className="flex-1 border-border border-t" aria-hidden="true" />
      <span id={id}>{label}</span>
      <span className="flex-1 border-border border-t" aria-hidden="true" />
    </div>
  );
}
