import { clientSecretSchema } from "@pagehall/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  List,
  ListRow,
  Notice,
  PasswordInput,
  SegmentedControl,
  Select,
} from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileKey2, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addCredential,
  type CredentialInput,
  certificateUrl,
  type IdentityProvider,
  identityKeys,
  type ProviderCredential,
  removeCredential,
} from "../../api/identity-queries.js";
import { useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";

export type CredentialDraft =
  | { kind: "clientSecret"; secret: string; expiresOn: string }
  | { kind: "certificate"; validDays: number };

export const CERTIFICATE_DAYS = [365, 730, 1095] as const;

export function emptyCredentialDraft(): CredentialDraft {
  return { kind: "clientSecret", secret: "", expiresOn: "" };
}

export function credentialInput(
  draft: CredentialDraft,
): { ok: true; value: CredentialInput } | { ok: false; field: "secret" | "expiresOn" } {
  if (draft.kind === "certificate")
    return { ok: true, value: { kind: "certificate", validDays: draft.validDays } };
  if (!clientSecretSchema.safeParse(draft.secret).success) return { ok: false, field: "secret" };
  if (draft.expiresOn && Number.isNaN(Date.parse(`${draft.expiresOn}T00:00:00Z`))) {
    return { ok: false, field: "expiresOn" };
  }
  return {
    ok: true,
    value: {
      kind: "clientSecret",
      secret: draft.secret,
      expiresAt: draft.expiresOn ? new Date(`${draft.expiresOn}T00:00:00Z`).toISOString() : null,
    },
  };
}

export function downloadCertificate(pem: string, name: string): void {
  const url = URL.createObjectURL(new Blob([pem], { type: "application/x-pem-file" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\w.-]+/g, "-").toLowerCase()}.pem`;
  link.click();
  URL.revokeObjectURL(url);
}

export function CredentialFields({
  draft,
  onChange,
  invalid,
}: {
  draft: CredentialDraft;
  onChange: (draft: CredentialDraft) => void;
  invalid: "secret" | "expiresOn" | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label={t("identityProviders.credentials.kind")}
        value={draft.kind}
        onValueChange={(kind) =>
          onChange(
            kind === "certificate"
              ? { kind: "certificate", validDays: 730 }
              : { kind: "clientSecret", secret: "", expiresOn: "" },
          )
        }
        options={[
          { value: "clientSecret", label: t("identityProviders.credentials.kinds.clientSecret") },
          { value: "certificate", label: t("identityProviders.credentials.kinds.certificate") },
        ]}
      />
      {draft.kind === "clientSecret" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t("identityProviders.credentials.secret")}
            {...(invalid === "secret" ? { error: t("validation.required") } : {})}
          >
            <PasswordInput
              autoComplete="off"
              className="font-mono"
              value={draft.secret}
              onChange={(event) => onChange({ ...draft, secret: event.target.value })}
            />
          </Field>
          <Field
            label={t("identityProviders.credentials.expiresOn")}
            hint={t("identityProviders.credentials.expiresOnHint")}
            {...(invalid === "expiresOn" ? { error: t("validation.format") } : {})}
          >
            <Input
              type="date"
              value={draft.expiresOn}
              onChange={(event) => onChange({ ...draft, expiresOn: event.target.value })}
            />
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Field
            label={t("identityProviders.credentials.validity")}
            hint={t("identityProviders.credentials.certificateHint")}
          >
            <Select
              aria-label={t("identityProviders.credentials.validity")}
              value={String(draft.validDays)}
              onValueChange={(value) => onChange({ kind: "certificate", validDays: Number(value) })}
              options={CERTIFICATE_DAYS.map((days) => ({
                value: String(days),
                label: t("identityProviders.credentials.years", { count: days / 365 }),
              }))}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export function CredentialsList({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProviderCredential | null>(null);
  const credentials = [...provider.credentials].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const refresh = () => queryClient.invalidateQueries({ queryKey: identityKeys.providers });
  return (
    <div className="flex flex-col gap-3">
      {credentials.length === 0 ? (
        <Notice variant="danger" title={t("identityProviders.credentials.noneTitle")}>
          {t("identityProviders.credentials.noneDescription")}
        </Notice>
      ) : null}
      <List label={t("identityProviders.credentials.title")}>
        {credentials.map((credential, index) => (
          <ListRow
            key={credential.id}
            icon={credential.kind === "certificate" ? FileKey2 : KeyRound}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t(`identityProviders.credentials.kinds.${credential.kind}`)}
                {index === 0 && credentials.length > 1 ? (
                  <Badge variant="accent">{t("identityProviders.credentials.newest")}</Badge>
                ) : null}
              </span>
            }
            description={t("identityProviders.credentials.details", {
              created: format.date(credential.createdAt),
              expires: credential.expiresAt
                ? format.date(credential.expiresAt)
                : t("identityProviders.credentials.never"),
            })}
            actions={
              <span className="flex flex-wrap gap-2">
                {credential.kind === "certificate" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Download}
                    onClick={() => globalThis.location.assign(certificateUrl(provider.id, credential.id))}
                  >
                    {t("identityProviders.credentials.download")}
                  </Button>
                ) : null}
                {canManage ? (
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => setRemoving(credential)}>
                    {t("common.remove")}
                  </Button>
                ) : null}
              </span>
            }
          />
        ))}
      </List>
      {canManage ? (
        <div>
          <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
            {t("identityProviders.credentials.add")}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-text-muted">{t("identityProviders.credentials.renewHint")}</p>
      {adding ? (
        <AddCredentialDialog
          provider={provider}
          onClose={() => setAdding(false)}
          onAdded={() => void refresh()}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? undefined : setRemoving(null))}
        title={t("identityProviders.credentials.removeTitle")}
        description={t("identityProviders.credentials.removeDescription")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeCredential(provider.id, removing.id);
            setRemoving(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.removeCredential"), failure);
          }
        }}
      />
    </div>
  );
}

function AddCredentialDialog({
  provider,
  onClose,
  onAdded,
}: {
  provider: IdentityProvider;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CredentialDraft>(emptyCredentialDraft());
  const [invalid, setInvalid] = useState<"secret" | "expiresOn" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [certificate, setCertificate] = useState<string | null>(null);
  const save = async () => {
    const input = credentialInput(draft);
    if (!input.ok) {
      setInvalid(input.field);
      return;
    }
    setInvalid(null);
    setBusy(true);
    setError(null);
    try {
      const created = await addCredential(provider.id, input.value);
      onAdded();
      if (created.certificate) setCertificate(created.certificate);
      else onClose();
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
      title={t("identityProviders.credentials.addTitle", { name: provider.name })}
      description={t("identityProviders.credentials.addDescription")}
      size="md"
      footer={
        certificate ? (
          <Button variant="primary" onClick={onClose}>
            {t("common.done")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              {t("identityProviders.credentials.save")}
            </Button>
          </>
        )
      }
    >
      {error ? (
        <Notice variant="danger" title={t("failures.addCredential")}>
          {error}
        </Notice>
      ) : null}
      {certificate ? (
        <div className="flex flex-col gap-3">
          <Notice variant="success" title={t("identityProviders.credentials.certificateCreated")}>
            {t("identityProviders.credentials.certificateUpload")}
          </Notice>
          <div>
            <Button
              variant="secondary"
              icon={Download}
              onClick={() => downloadCertificate(certificate, provider.name)}
            >
              {t("identityProviders.credentials.download")}
            </Button>
          </div>
        </div>
      ) : (
        <CredentialFields draft={draft} onChange={setDraft} invalid={invalid} />
      )}
    </Dialog>
  );
}
