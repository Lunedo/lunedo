import { Button, Notice } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { instanceInfoQuery } from "../api/queries.js";
import { setMovedHandler } from "../api/request.js";

export function movedAddress(instanceUrl: string | null | undefined, origin: string): string | null {
  if (!instanceUrl) return null;
  try {
    return new URL(instanceUrl).origin === origin ? null : instanceUrl;
  } catch {
    return null;
  }
}

function currentOrigin(): string {
  return globalThis.location?.origin ?? "";
}

export function InstanceMovedGuard({ children }: { children: ReactNode }) {
  const info = useQuery({ ...instanceInfoQuery, throwOnError: false });
  const [reported, setReported] = useState<string | null>(null);
  useEffect(() => {
    setMovedHandler(setReported);
    return () => setMovedHandler(null);
  }, []);
  const moved = movedAddress(info.data?.url, currentOrigin()) ?? movedAddress(reported, currentOrigin());
  if (!moved || globalThis.location?.pathname.startsWith("/setup")) return children;
  return <InstanceMovedScreen url={moved} />;
}

export function InstanceMovedScreen({ url }: { url: string }) {
  const { t } = useTranslation();
  const target = `${new URL(url).origin}${globalThis.location?.pathname ?? "/"}`;
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-bg p-4 text-text">
      <div className="flex w-full max-w-card-wide flex-col gap-4">
        <Notice variant="warning" title={t("instance.general.movedTitle")}>
          <div className="flex flex-col gap-3">
            <p>{t("instance.general.movedDescription", { old: currentOrigin(), url })}</p>
            <p>{t("instance.general.movedPasskeys")}</p>
          </div>
        </Notice>
        <div>
          <Button asChild variant="primary" size="lg">
            <a href={target}>
              <ExternalLink aria-hidden="true" className="size-icon-md" />
              {t("instance.general.movedAction", { url })}
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}
