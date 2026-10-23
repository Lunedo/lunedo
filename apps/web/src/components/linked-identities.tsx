import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  List,
  ListRow,
  Notice,
  Select,
  Skeleton,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import {
  accountIdentitiesQuery,
  identityKeys,
  type LinkedIdentity,
  ownIdentitiesQuery,
  providersQuery,
} from "../api/identity-queries.js";
import { request } from "../api/request.js";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";

function IdentityRows({
  identities,
  onUnlink,
}: {
  identities: LinkedIdentity[];
  onUnlink?: (identity: LinkedIdentity) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <List label={t("identities.list")}>
      {identities.map((identity) => (
        <ListRow
          key={identity.id}
          icon={KeyRound}
          title={identity.providerName}
          description={[
            identity.signInName
              ? t("identities.signInName", { name: identity.signInName })
              : (identity.email ?? identity.subject),
            identity.lastSignInAt
              ? t("identities.lastSignIn", { time: format.relative(identity.lastSignInAt) })
              : t("identities.neverUsed"),
          ].join(" · ")}
          {...(onUnlink
            ? {
                actions: (
                  <Button variant="secondary" size="sm" icon={Unlink} onClick={() => onUnlink(identity)}>
                    {t("identities.unlink")}
                  </Button>
                ),
              }
            : {})}
        />
      ))}
    </List>
  );
}

export function OwnIdentities() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const identities = useQuery({ ...ownIdentitiesQuery, throwOnError: false });
  const [unlinking, setUnlinking] = useState<LinkedIdentity | null>(null);
  if (identities.isPending) return <Skeleton className="h-12 w-full" />;
  if (identities.isError) {
    return (
      <LoadError
        what={t("failures.loadIdentities")}
        error={identities.error}
        onRetry={() => identities.refetch()}
      />
    );
  }
  if (identities.data.length === 0) {
    return <p className="py-3 text-sm text-text-muted">{t("identities.noneOwn")}</p>;
  }
  return (
    <>
      <IdentityRows identities={identities.data} onUnlink={setUnlinking} />
      <p className="py-3 text-sm text-text-muted">{t("identities.ownHint")}</p>
      <ConfirmDialog
        open={unlinking !== null}
        onOpenChange={(next) => (next ? undefined : setUnlinking(null))}
        title={t("identities.unlinkTitle", { provider: unlinking?.providerName ?? "" })}
        description={t("identities.unlinkOwnDescription")}
        confirmLabel={t("identities.unlink")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!unlinking) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/account/identities/{identityId}", {
                params: { path: { identityId: unlinking.id } },
              }),
            );
            setUnlinking(null);
            await queryClient.invalidateQueries({ queryKey: identityKeys.ownIdentities });
          } catch (failure) {
            setUnlinking(null);
            showFailure(t("failures.unlinkIdentity"), failure);
          }
        }}
      />
    </>
  );
}

export function AccountIdentities({ accountId, manage }: { accountId: string; manage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const identities = useQuery({ ...accountIdentitiesQuery(accountId), throwOnError: false });
  const [unlinking, setUnlinking] = useState<LinkedIdentity | null>(null);
  const [linking, setLinking] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: identityKeys.accountIdentities(accountId) });
  if (identities.isPending) return <Skeleton className="h-12 w-full" />;
  if (identities.isError) {
    return (
      <LoadError
        what={t("failures.loadIdentities")}
        error={identities.error}
        onRetry={() => identities.refetch()}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {identities.data.length === 0 ? (
        <p className="text-sm text-text-muted">{t("identities.none")}</p>
      ) : (
        <IdentityRows identities={identities.data} {...(manage ? { onUnlink: setUnlinking } : {})} />
      )}
      {manage ? (
        <div>
          <Button variant="secondary" size="sm" icon={Link2} onClick={() => setLinking(true)}>
            {t("identities.link")}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={unlinking !== null}
        onOpenChange={(next) => (next ? undefined : setUnlinking(null))}
        title={t("identities.unlinkTitle", { provider: unlinking?.providerName ?? "" })}
        description={t("identities.unlinkDescription")}
        confirmLabel={t("identities.unlink")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!unlinking) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/accounts/{accountId}/identities/{identityId}", {
                params: { path: { accountId, identityId: unlinking.id } },
              }),
            );
            setUnlinking(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.unlinkIdentity"), failure);
          }
        }}
      />
      {linking ? (
        <LinkIdentityDialog
          accountId={accountId}
          onClose={() => setLinking(false)}
          onLinked={async () => {
            setLinking(false);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function LinkIdentityDialog({
  accountId,
  onClose,
  onLinked,
}: {
  accountId: string;
  onClose: () => void;
  onLinked: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const providers = useQuery({ ...providersQuery, throwOnError: false });
  const [providerId, setProviderId] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<"provider" | "subject" | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!providerId) {
      setInvalid("provider");
      focusFirstInvalidSoon();
      return;
    }
    if (!subject.trim()) {
      setInvalid("subject");
      focusFirstInvalidSoon();
      return;
    }
    setInvalid(null);
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/accounts/{accountId}/identities", {
          params: { path: { accountId } },
          body: { providerId, subject: subject.trim() },
        }),
      );
      await onLinked();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={t("identities.linkTitle")}
      description={t("identities.linkDescription")}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t("identities.link")}
          </Button>
        </>
      }
    >
      {error ? (
        <Notice variant="danger" title={t("failures.linkIdentity")}>
          {error}
        </Notice>
      ) : null}
      {providers.isError ? (
        <LoadError
          what={t("failures.loadProviders")}
          error={providers.error}
          onRetry={() => providers.refetch()}
        />
      ) : null}
      <Field
        label={t("identities.provider")}
        {...(invalid === "provider" ? { error: t("validation.required") } : {})}
      >
        <Select
          aria-label={t("identities.provider")}
          value={providerId}
          placeholder={t("identities.chooseProvider")}
          onValueChange={setProviderId}
          options={(providers.data ?? []).map((provider) => ({ value: provider.id, label: provider.name }))}
        />
      </Field>
      <Field
        label={t("identities.subject")}
        hint={t("identities.subjectHint")}
        {...(invalid === "subject" ? { error: t("validation.required") } : {})}
      >
        <Input className="font-mono" value={subject} onChange={(event) => setSubject(event.target.value)} />
      </Field>
    </Dialog>
  );
}
