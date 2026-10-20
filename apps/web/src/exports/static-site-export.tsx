import { Button, Field, focusFirstInvalidSoon, Input, Notice } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";
import { defaultExportOptions, exportKeys, exportsQuery, startExport } from "./export-queries.js";

function validSiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function StaticSiteExport({
  space,
}: {
  space: { id: string; key: string; audience: string | null; exportEnabled: boolean };
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const exports = useQuery({ ...exportsQuery, throwOnError: false });
  const previous =
    exports.data?.find((entry) => entry.spaceId === space.id && entry.format === "site")?.options.siteUrl ??
    null;
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const value = siteUrl ?? previous ?? "";

  if (space.audience !== "public") {
    return (
      <Notice variant="info" title={t("exports.site.notPublicTitle")}>
        <p>{t("exports.site.notPublic")}</p>
        <Link
          to="/spaces/$spaceKey/settings/visibility"
          params={{ spaceKey: space.key }}
          className="mt-2 inline-flex min-h-hit items-center text-accent hover:underline focus-visible:focus-ring"
        >
          {t("exports.site.toVisibility")}
        </Link>
      </Notice>
    );
  }
  if (!space.exportEnabled) {
    return <Notice variant="info">{t("exports.site.exportOff")}</Notice>;
  }

  const check = (input: string) => {
    const address = input.trim();
    return address && !validSiteUrl(address) ? t("exports.site.invalidUrl") : null;
  };

  const start = async () => {
    const address = value.trim();
    setFailure(null);
    setStarted(false);
    if (address && !validSiteUrl(address)) {
      setError(t("exports.site.invalidUrl"));
      focusFirstInvalidSoon();
      return;
    }
    setError(null);
    setStarting(true);
    try {
      await startExport({ spaceId: space.id }, "site", {
        ...defaultExportOptions,
        siteUrl: address || null,
      });
      await queryClient.invalidateQueries({ queryKey: exportKeys.all });
      setStarted(true);
    } catch (cause) {
      setFailure(problemMessage(t, cause));
    } finally {
      setStarting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <p className="text-sm text-text-muted">{t("exports.site.description")}</p>
      <Field
        label={t("exports.site.address")}
        hint={t("exports.site.addressHint")}
        {...(error ? { error } : {})}
      >
        <Input
          type="url"
          inputMode="url"
          placeholder={t("exports.site.addressPlaceholder")}
          value={value}
          onChange={(event) => {
            setSiteUrl(event.target.value);
            if (error) setError(check(event.target.value));
          }}
          onBlur={(event) => setError(check(event.target.value))}
        />
      </Field>
      {failure ? (
        <Notice variant="danger" title={t("exports.site.failed")}>
          {failure}
        </Notice>
      ) : null}
      {started ? <Notice variant="success">{t("exports.site.started")}</Notice> : null}
      <div>
        <Button type="submit" variant="primary" icon={Globe} loading={starting}>
          {t("exports.site.start")}
        </Button>
      </div>
    </form>
  );
}
