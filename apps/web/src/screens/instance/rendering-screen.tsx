import { Badge, type BadgeVariant, Button, Notice, Section, SettingRow, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Printer, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type RenderingStatus, renderingQuery } from "../../api/instance-queries.js";
import { DRAWIO_VERSION } from "../../diagrams/drawio-version.js";
import { docsUrl } from "../../docs/docs-url.js";
import { LoadError } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { SettingsPage } from "../settings/settings-page.js";

const STATE_BADGES: Record<string, BadgeVariant> = {
  notConfigured: "neutral",
  healthy: "success",
  unreachable: "danger",
};

const COMPOSE_SNIPPET = `  pagehall-render:
    image: ghcr.io/pagehall/render:latest
    restart: unless-stopped
    environment:
      RENDER_TOKEN: \${PAGEHALL_RENDER_TOKEN}

  pagehall:
    environment:
      PAGEHALL_RENDER_URL: http://pagehall-render:3000
      PAGEHALL_RENDER_TOKEN: \${PAGEHALL_RENDER_TOKEN}`;

function PdfSection({
  status,
  onCheck,
  checking,
}: {
  status: RenderingStatus;
  onCheck: () => void;
  checking: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const pdf = status.pdf;
  const state = pdf.state;
  return (
    <Section title={t("rendering.pdf.title")}>
      <SettingRow
        label={t("rendering.pdf.status")}
        description={
          pdf.checkedAt ? t("rendering.pdf.checked", { time: format.relative(pdf.checkedAt) }) : undefined
        }
        control={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATE_BADGES[state] ?? "neutral"}>
              {translateKey(t, `rendering.pdf.states.${state}`)}
            </Badge>
            {state === "notConfigured" ? null : (
              <Button size="sm" variant="secondary" icon={RefreshCw} loading={checking} onClick={onCheck}>
                {t("rendering.pdf.check")}
              </Button>
            )}
          </div>
        }
      />
      {state === "unreachable" && pdf.reason ? (
        <div className="px-4 py-3">
          <Notice variant="danger" title={translateKey(t, `rendering.pdf.states.${state}`)}>
            {translateKey(t, `rendering.pdf.reasons.${pdf.reason}`)}
          </Notice>
        </div>
      ) : null}
      {pdf.url ? (
        <SettingRow
          label={t("rendering.pdf.address")}
          control={<code className="break-all">{pdf.url}</code>}
        />
      ) : null}
      {state === "healthy" ? (
        <>
          <SettingRow label={t("rendering.pdf.version")} control={<span>{pdf.version}</span>} />
          <SettingRow label={t("rendering.pdf.browser")} control={<span>{pdf.browser}</span>} />
          <SettingRow
            label={t("rendering.pdf.concurrency")}
            description={t("rendering.pdf.concurrencyHint")}
            control={<span>{pdf.concurrency}</span>}
          />
          <SettingRow
            label={t("rendering.pdf.queue")}
            control={
              <span>
                {t("rendering.pdf.queueValue", { running: pdf.running ?? 0, waiting: pdf.waiting ?? 0 })}
              </span>
            }
          />
          <SettingRow
            label={t("rendering.pdf.limits")}
            control={
              <span>
                {t("rendering.pdf.limitsValue", {
                  size: format.bytes(pdf.maxBytes ?? 0),
                  seconds: pdf.timeoutSeconds ?? 0,
                })}
              </span>
            }
          />
          <p className="px-4 py-3 text-sm text-text-muted">{t("rendering.pdf.usedFor")}</p>
        </>
      ) : null}
      {state === "notConfigured" ? (
        <div className="flex flex-col gap-3 px-4 py-3">
          <Notice variant="info" title={t("rendering.pdf.notConfiguredTitle")}>
            {t("rendering.pdf.notConfigured")}
          </Notice>
          <p className="text-sm">{t("rendering.pdf.setup")}</p>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken p-3 font-mono text-sm">
            {COMPOSE_SNIPPET}
          </pre>
          <a
            href={docsUrl("rendering.md")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent underline focus-visible:focus-ring"
          >
            {t("rendering.pdf.docs")}
          </a>
        </div>
      ) : null}
    </Section>
  );
}

export function InstanceRenderingScreen() {
  const { t } = useTranslation();
  const status = useQuery({ ...renderingQuery, throwOnError: false });
  return (
    <SettingsPage title={t("rendering.title")} description={t("rendering.description")} icon={Printer}>
      {status.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {status.isError ? (
        <LoadError
          what={t("rendering.pdf.loadFailed")}
          error={status.error}
          onRetry={() => status.refetch()}
        />
      ) : null}
      {status.data ? (
        <>
          <PdfSection
            status={status.data}
            onCheck={() => void status.refetch()}
            checking={status.isFetching}
          />
          <Section title={t("rendering.other.title")}>
            <SettingRow
              label={t("rendering.other.word")}
              description={t("rendering.other.wordDescription")}
              control={<Badge variant="success">{t("rendering.other.available")}</Badge>}
            />
            <SettingRow
              label={t("rendering.other.diagrams")}
              description={t("rendering.other.diagramsDescription")}
              control={<Badge variant="success">{t("rendering.other.available")}</Badge>}
            />
            <SettingRow
              label={t("rendering.other.drawio")}
              description={t("rendering.other.drawioDescription", { version: DRAWIO_VERSION })}
              control={<Badge variant="success">{t("rendering.other.servedLocally")}</Badge>}
            />
          </Section>
        </>
      ) : null}
    </SettingsPage>
  );
}
