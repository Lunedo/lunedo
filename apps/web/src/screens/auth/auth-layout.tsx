import { Combobox } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { instanceInfoQuery } from "../../api/queries.js";
import { languageItems } from "../../components/pickers.js";
import { isLanguage, rememberChosenLanguage, rememberLanguage } from "../../i18n/index.js";
import { isAccentColor } from "../../preferences/preferences.js";
import { setAccentColor } from "../../preferences/preferences-provider.js";
import { BrandMark } from "../../shell/brand.js";

export function AuthLayout() {
  const { t } = useTranslation();
  const info = useQuery(instanceInfoQuery);
  const accent = info.data?.organization?.accentColor ?? info.data?.accentColor;

  useEffect(() => {
    if (isAccentColor(accent)) setAccentColor(accent);
  }, [accent]);

  return (
    <div className="flex min-h-full flex-col bg-sidebar">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Outlet />
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-3 px-4 pb-6 text-sm text-text-muted">
        <span>{info.data?.name ?? ""}</span>
        <span aria-hidden="true">·</span>
        <LanguagePicker label={t("auth.language")} ownLanguage />
      </footer>
    </div>
  );
}

export function LanguagePicker({ label, ownLanguage = false }: { label: string; ownLanguage?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="w-field max-w-full">
      <Combobox
        aria-label={label}
        value={i18n.language}
        onValueChange={(language) => {
          if (!isLanguage(language)) return;
          rememberLanguage(language);
          if (ownLanguage) rememberChosenLanguage(language);
          void i18n.changeLanguage(language);
        }}
        items={languageItems(t)}
      />
    </div>
  );
}

export function AuthCard({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const info = useQuery(instanceInfoQuery);
  const organization = info.data?.organization;
  return (
    <div
      className={`flex w-full flex-col gap-5 rounded-lg border border-border bg-surface p-6 shadow-card ${wide ? "max-w-card-wide" : "max-w-card"}`}
    >
      <BrandMark
        organization={
          organization?.logoRef
            ? { id: organization.id, name: organization.name, logoRef: organization.logoRef }
            : null
        }
      />
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-heading">{title}</h1>
        {description ? <p className="text-text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
