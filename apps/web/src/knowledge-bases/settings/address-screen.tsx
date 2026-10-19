import {
  Button,
  CopyButton,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  Select,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { ApiError, request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { Panel } from "../../spaces/settings/panel.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { useSpace } from "../../spaces/space-context.js";
import {
  knowledgeBaseKeys,
  type PortalDomain,
  type PortalSettings,
  portalDomainsQuery,
  portalQuery,
} from "../queries.js";

const PATH = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PATH_MAX = 60;
const NO_DOMAIN = "none";
const PATH_ERRORS = new Set(["invalidPortalPath", "portalPathTaken"]);

export function PortalAddressScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const portal = useQuery({ ...portalQuery(space.id), throwOnError: false });
  return (
    <SpaceSettingsPage
      tab="address"
      title={t("knowledgeBase.address.title")}
      description={t("knowledgeBase.address.description")}
      icon={Globe}
    >
      {portal.isPending ? <Skeleton className="h-field w-full" /> : null}
      {portal.isError ? (
        <LoadError
          what={t("knowledgeBase.address.loadFailed")}
          error={portal.error}
          onRetry={() => portal.refetch()}
        />
      ) : null}
      {portal.data ? <AddressPanel portal={portal.data} /> : null}
    </SpaceSettingsPage>
  );
}

export function AddressPanel({ portal }: { portal: PortalSettings }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editable = space.role === "admin" && !space.archived;
  const domains = useQuery({ ...portalDomainsQuery(space.id), enabled: editable, throwOnError: false });
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState(portal.path);
  const [domain, setDomain] = useState(portal.domain ?? NO_DOMAIN);
  const [pathError, setPathError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const host = window.location.hostname;
  const instance = `${window.location.host}/help/`;
  const chosen = domain === NO_DOMAIN ? null : domain;
  const available = (domains.data ?? []).filter(
    (entry: PortalDomain) => entry.spaceId === null || entry.spaceId === space.id,
  );

  const cancel = () => {
    setPath(portal.path);
    setDomain(portal.domain ?? NO_DOMAIN);
    setPathError(null);
    setDomainError(null);
    setEditing(false);
  };

  const save = async () => {
    const trimmed = path.trim().toLowerCase();
    if (!PATH.test(trimmed) || trimmed.length > PATH_MAX) {
      setPathError(t("knowledgeBase.address.pathInvalid"));
      focusFirstInvalidSoon();
      return;
    }
    setPathError(null);
    setDomainError(null);
    setSaving(true);
    try {
      const updated = await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/portal/address", {
          params: { path: { spaceId: space.id } },
          body: { path: trimmed, domain: chosen },
        }),
      );
      queryClient.setQueryData(knowledgeBaseKeys.portal(space.id), updated);
      await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.domains(space.id) });
      toast({ title: t("knowledgeBase.address.saved"), variant: "success" });
      setEditing(false);
    } catch (error) {
      const message = problemMessage(t, error);
      if (error instanceof ApiError && PATH_ERRORS.has(error.code)) setPathError(message);
      else setDomainError(message);
      focusFirstInvalidSoon();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={t("knowledgeBase.address.panel")}
      {...(editable && !editing
        ? {
            actions: (
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
                {t("knowledgeBase.address.change")}
              </Button>
            ),
          }
        : {})}
    >
      {editing ? (
        <div className="flex flex-col gap-4">
          {chosen ? (
            <Notice variant="info" title={t("knowledgeBase.address.dnsTitle")}>
              <p>{t("knowledgeBase.address.dnsText", { domain: chosen })}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-sm bg-surface-sunken px-2 py-1 font-mono text-sm">
                  {`${chosen} CNAME ${host}.`}
                </code>
                <CopyButton value={`${chosen} CNAME ${host}.`} label={t("knowledgeBase.address.copyDns")} />
              </div>
            </Notice>
          ) : null}
          <Field
            label={t("knowledgeBase.address.path")}
            hint={t("knowledgeBase.address.pathHint", { prefix: instance })}
            {...(pathError ? { error: pathError } : {})}
          >
            <Input
              value={path}
              maxLength={PATH_MAX}
              className="font-mono"
              onChange={(event) => setPath(event.target.value)}
            />
          </Field>
          <Field
            label={t("knowledgeBase.address.domain")}
            hint={
              available.length === 0
                ? t("knowledgeBase.address.noDomains")
                : t("knowledgeBase.address.domainHint")
            }
            {...(domainError ? { error: domainError } : {})}
          >
            <Select
              value={domain}
              onValueChange={setDomain}
              options={[
                { value: NO_DOMAIN, label: t("knowledgeBase.address.noDomain") },
                ...available.map((entry: PortalDomain) => ({ value: entry.domain, label: entry.domain })),
              ]}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {t("common.save")}
            </Button>
            <Button variant="secondary" onClick={cancel}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="font-medium">{t("knowledgeBase.address.path")}</dt>
            <dd className="font-mono break-all">{`${window.location.origin}/help/${portal.path}/`}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">{t("knowledgeBase.address.domain")}</dt>
            <dd className={portal.domain ? "font-mono break-all" : "text-text-muted"}>
              {portal.domain ? `https://${portal.domain}/` : t("knowledgeBase.address.noDomain")}
            </dd>
          </div>
          <p className="text-text-muted">{t("knowledgeBase.address.footnote")}</p>
          {editable ? null : <p className="text-text-muted">{t("knowledgeBase.address.adminsOnly")}</p>}
        </dl>
      )}
    </Panel>
  );
}
