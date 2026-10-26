import {
  Badge,
  Button,
  Combobox,
  Field,
  InlineField,
  Notice,
  Section,
  Table,
  TruncatedText,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { breakGlassQuery, instanceKeys, instanceOrganizationsQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { BreakGlassDialog } from "./break-glass-dialog.js";
import { useInstanceSettingsEditor } from "./general-screen.js";

type Entry = Awaited<ReturnType<NonNullable<(typeof breakGlassQuery)["queryFn"]>>>[number];

export function breakGlassStatus(entry: Entry, now = new Date()): "active" | "ended" | "expired" {
  if (entry.endedAt) return "ended";
  return new Date(entry.expiresAt) > now ? "active" : "expired";
}

export function BreakGlassScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const state = useOrganizationState();
  const session = useSession();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const editor = useInstanceSettingsEditor();
  const entries = useQuery(breakGlassQuery);
  const organizations = useQuery(instanceOrganizationsQuery);
  const [organizationId, setOrganizationId] = useState("");
  const [requesting, setRequesting] = useState<{ id: string; name: string } | null>(null);
  const canRequest = state.can("instance.breakGlass.request");
  const memberOf = new Set(state.organizations.map((entry) => entry.id));
  const candidates = (organizations.data ?? []).filter((entry) => !memberOf.has(entry.id));

  const end = async (entry: Entry) => {
    try {
      await request(() =>
        api.DELETE("/api/v1/organizations/{organizationId}/break-glass/{accessId}", {
          params: { path: { organizationId: entry.organizationId, accessId: entry.id } },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: instanceKeys.breakGlass });
      await queryClient.invalidateQueries({ queryKey: ["account", "permissions"] });
    } catch (failure) {
      showFailure(t("failures.endBreakGlass"), failure);
    }
  };

  return (
    <SettingsPage title={t("breakGlass.title")} description={t("breakGlass.description")}>
      <p className="text-sm text-text-muted">
        {t("breakGlass.otherEmergency")}{" "}
        <Link to="/settings/instance/sign-in-providers" className="font-medium text-accent hover:underline">
          {t("emergencyRecipients.title")}
        </Link>
      </p>
      <Section title={t("breakGlass.duration")}>
        <SettingsList {...editor} keys={["organizations.breakGlassMinutes"]} level="instance" />
      </Section>
      {canRequest ? (
        <Section title={t("breakGlass.request")}>
          <div className="flex flex-wrap items-end gap-3 p-4">
            <InlineField>
              <Field label={t("breakGlass.organization")}>
                <Combobox
                  aria-label={t("breakGlass.organization")}
                  value={organizationId || null}
                  onValueChange={(value) => setOrganizationId(value ?? "")}
                  placeholder={t("breakGlass.chooseOrganization")}
                  items={candidates.map((entry) => ({ value: entry.id, label: entry.name }))}
                />
              </Field>
            </InlineField>
            <Button
              variant="outline"
              icon={ShieldAlert}
              disabled={!organizationId}
              onClick={() => {
                const organization = candidates.find((entry) => entry.id === organizationId);
                if (organization) setRequesting(organization);
              }}
            >
              {t("breakGlass.continue")}
            </Button>
          </div>
          {candidates.length === 0 && organizations.isSuccess ? (
            <div className="pb-4">
              <Notice variant="info">{t("breakGlass.noCandidates")}</Notice>
            </div>
          ) : null}
        </Section>
      ) : null}
      <Section title={t("breakGlass.recent")}>
        <Table
          caption={t("breakGlass.recent")}
          rowKey={(entry) => entry.id}
          rows={entries.data ?? []}
          loading={entries.isPending}
          empty={<p className="p-4 text-text-muted">{t("breakGlass.none")}</p>}
          columns={[
            {
              key: "organization",
              header: t("breakGlass.organization"),
              cell: (entry) => (
                <TruncatedText text={entry.organizationName} className="max-w-field font-medium" />
              ),
            },
            { key: "account", header: t("breakGlass.requestedBy"), cell: (entry) => entry.accountName },
            { key: "reason", header: t("breakGlass.reason"), hideBelow: "md", cell: (entry) => entry.reason },
            {
              key: "time",
              header: t("breakGlass.time"),
              hideBelow: "sm",
              cell: (entry) =>
                `${format.dateTime(entry.startedAt)} – ${format.time(entry.endedAt ?? entry.expiresAt)}`,
            },
            {
              key: "status",
              header: t("breakGlass.status"),
              cell: (entry) => {
                const status = breakGlassStatus(entry);
                return (
                  <Badge variant={status === "active" ? "warning" : "neutral"}>
                    {t(`breakGlass.statuses.${status}`)}
                  </Badge>
                );
              },
            },
            {
              key: "actions",
              sticky: true,
              header: t("settings.actions"),
              align: "end",
              cell: (entry) =>
                breakGlassStatus(entry) === "active" && entry.accountId === session.account?.id ? (
                  <Button variant="danger" size="sm" onClick={() => void end(entry)}>
                    {t("breakGlass.end")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
      {requesting ? <BreakGlassDialog organization={requesting} onClose={() => setRequesting(null)} /> : null}
    </SettingsPage>
  );
}
