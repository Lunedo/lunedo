import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  List,
  ListRow,
  Notice,
  Section,
  SettingRow,
  Skeleton,
  Table,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CreatedScimToken,
  createScimToken,
  type IdentityProvider,
  identityKeys,
  removeScimToken,
  renewScimToken,
  type ScimStatus,
  scimStatusQuery,
} from "../../api/identity-queries.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { CopyField } from "./provider-config.js";

type ScimToken = ScimStatus["tokens"][number];

interface EntraMapping {
  target: string;
  source: string;
  when: "identityProviders.scim.mappingExternalIdWhen" | "identityProviders.scim.mappingEmailWhen";
}

const ENTRA_MAPPINGS: EntraMapping[] = [
  { target: "externalId", source: "objectId", when: "identityProviders.scim.mappingExternalIdWhen" },
  {
    target: 'emails[type eq "work"].value',
    source: "userPrincipalName",
    when: "identityProviders.scim.mappingEmailWhen",
  },
];

export function ScimTab({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const { toast } = useToast();
  const status = useQuery({ ...scimStatusQuery(provider.id), throwOnError: false });
  const [created, setCreated] = useState<CreatedScimToken | null>(null);
  const [removing, setRemoving] = useState<ScimToken | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: identityKeys.provider(provider.id) });
  const entra = provider.config.preset === "entraId";

  const run = async (key: string, action: () => Promise<CreatedScimToken>, failure: string) => {
    setBusy(key);
    try {
      setCreated(await action());
      await refresh();
    } catch (error) {
      showFailure(failure, error);
    } finally {
      setBusy(null);
    }
  };

  if (status.isPending) return <Skeleton className="h-12 w-full" />;
  if (status.isError) {
    return <LoadError what={t("failures.loadScim")} error={status.error} onRetry={() => status.refetch()} />;
  }
  const data = status.data;
  const tokens = data.tokens;
  const receiving = data.lastRequestAt !== null;

  return (
    <div className="flex flex-col gap-6">
      <Notice variant="info">
        <div className="flex flex-col gap-2">
          <p>{t("identityProviders.scim.intro")}</p>
          <p>{t("identityProviders.scim.accounts")}</p>
          {entra ? (
            <p>{t("identityProviders.scim.entraSetup")}</p>
          ) : (
            <p>{t("identityProviders.scim.genericSetup")}</p>
          )}
        </div>
      </Notice>
      {entra ? (
        <Section title={t("identityProviders.scim.entraMappings")}>
          <p className="pt-3 text-sm text-text-muted">{t("identityProviders.scim.entraMappingsHint")}</p>
          <Table
            caption={t("identityProviders.scim.entraMappings")}
            rowKey={(row) => row.target}
            rows={ENTRA_MAPPINGS}
            columns={[
              {
                key: "target",
                header: t("identityProviders.scim.mappingTarget"),
                cell: (row) => <code className="font-mono">{row.target}</code>,
              },
              {
                key: "source",
                header: t("identityProviders.scim.mappingSource"),
                cell: (row) => <code className="font-mono">{row.source}</code>,
              },
              {
                key: "when",
                header: t("identityProviders.scim.mappingWhen"),
                cell: (row) => t(row.when),
              },
            ]}
          />
        </Section>
      ) : null}
      <Section title={t("identityProviders.scim.connection")}>
        <div className="flex flex-col gap-4 py-3">
          <CopyField
            label={t("identityProviders.scim.url")}
            value={data.url}
            hint={t("identityProviders.scim.urlHint")}
          />
          <div className="flex flex-col gap-2">
            <span className="font-medium">{t("identityProviders.scim.tokens")}</span>
            {tokens.length === 0 ? (
              <p className="text-sm text-text-muted">{t("identityProviders.scim.noTokens")}</p>
            ) : (
              <List label={t("identityProviders.scim.tokens")}>
                {tokens.map((token) => (
                  <ListRow
                    key={token.id}
                    icon={KeyRound}
                    title={<span className="font-mono">{`${token.prefix}…`}</span>}
                    description={[
                      t("identityProviders.scim.createdOn", { date: format.date(token.createdAt) }),
                      token.lastUsedAt
                        ? t("identityProviders.scim.lastUsed", { time: format.dateTime(token.lastUsedAt) })
                        : t("identityProviders.scim.neverUsed"),
                      token.expiresAt
                        ? t("identityProviders.scim.expiresOn", { time: format.dateTime(token.expiresAt) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    actions={
                      canManage ? (
                        <div className="flex flex-wrap gap-2">
                          {token.expiresAt ? null : (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={RefreshCw}
                              loading={busy === token.id}
                              onClick={() =>
                                void run(
                                  token.id,
                                  () => renewScimToken(provider.id, token.id),
                                  t("failures.renewScimToken"),
                                )
                              }
                            >
                              {t("identityProviders.scim.renew")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Trash2}
                            onClick={() => setRemoving(token)}
                          >
                            {t("common.removeToken")}
                          </Button>
                        </div>
                      ) : undefined
                    }
                  />
                ))}
              </List>
            )}
            {canManage && tokens.length === 0 ? (
              <div>
                <Button
                  variant="primary"
                  icon={Plus}
                  loading={busy === "create"}
                  onClick={() =>
                    void run("create", () => createScimToken(provider.id), t("failures.createScimToken"))
                  }
                >
                  {t("identityProviders.scim.create")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </Section>
      <Section title={t("identityProviders.scim.status")}>
        <SettingRow
          label={t("identityProviders.scim.lastRequest")}
          description={
            receiving && data.lastRequestAt
              ? t("identityProviders.scim.lastRequestDetail", {
                  time: format.dateTime(data.lastRequestAt),
                  changes: data.lastDay.changes,
                  failed: data.lastDay.failed,
                })
              : t("identityProviders.scim.noRequests")
          }
          control={
            tokens.length === 0 ? (
              <Badge variant="neutral">{t("identityProviders.scim.off")}</Badge>
            ) : data.lastDay.failed > 0 ? (
              <Badge variant="warning">{t("identityProviders.scim.withErrors")}</Badge>
            ) : receiving ? (
              <Badge variant="success">{t("identityProviders.scim.receiving")}</Badge>
            ) : (
              <Badge variant="neutral">{t("identityProviders.scim.waiting")}</Badge>
            )
          }
        />
        {tokens.length > 0 ? (
          <p className="pb-3 text-sm text-text-muted">{t("identityProviders.scim.leads")}</p>
        ) : null}
      </Section>
      {created ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setCreated(null);
          }}
          title={t("identityProviders.scim.createdTitle")}
          size="md"
          footer={
            <Button variant="primary" onClick={() => setCreated(null)}>
              {t("common.done")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <Notice variant="warning">{t("identityProviders.scim.onlyOnce")}</Notice>
            <CopyField label={t("identityProviders.scim.secretToken")} value={created.token} />
            {tokens.some((token) => token.expiresAt) ? (
              <p className="text-sm text-text-muted">{t("identityProviders.scim.overlap")}</p>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("identityProviders.scim.removeTitle")}
        description={t(
          tokens.length === 1
            ? "identityProviders.scim.removeLast"
            : "identityProviders.scim.removeDescription",
        )}
        confirmLabel={t("common.removeToken")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeScimToken(provider.id, removing.id);
            setRemoving(null);
            toast({ title: t("identityProviders.scim.removed"), variant: "success" });
            await refresh();
          } catch (error) {
            showFailure(t("failures.removeScimToken"), error);
          }
        }}
      />
    </div>
  );
}
