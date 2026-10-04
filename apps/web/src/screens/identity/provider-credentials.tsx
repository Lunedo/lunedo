import { clientSecretSchema, directoryPasswordSchema } from "@pagehall/shared";
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
import type { TFunction } from "i18next";
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

export type CredentialKind = CredentialInput["kind"];

export type CredentialDraft =
  | { kind: "clientSecret"; secret: string; expiresOn: string }
  | { kind: "certificate"; validDays: number }
  | { kind: "samlSigning"; validDays: number }
  | { kind: "bindPassword"; secret: string };

export const CERTIFICATE_DAYS = [365, 730, 1095] as const;

export function emptyCredentialDraft(kind: CredentialKind = "clientSecret"): CredentialDraft {
  if (kind === "certificate" || kind === "samlSigning") return { kind, validDays: 730 };
  if (kind === "bindPassword") return { kind, secret: "" };
  return { kind: "clientSecret", secret: "", expiresOn: "" };
}

export function credentialKinds(provider: Pick<IdentityProvider, "type" | "config">): CredentialKind[] {
  if (provider.type === "ldap") return ["bindPassword"];
  if (provider.type === "saml") {
    return provider.config.preset === "entraId"
      ? ["samlSigning", "clientSecret", "certificate"]
      : ["samlSigning"];
  }
  return ["clientSecret", "certificate"];
}

export function credentialKindLabel(
  t: TFunction,
  provider: Pick<IdentityProvider, "type">,
  kind: CredentialKind,
): string {
  if (provider.type === "saml" && (kind === "clientSecret" || kind === "certificate")) {
    return t(`identityProviders.credentials.graphKinds.${kind}`);
  }
  return t(`identityProviders.credentials.kinds.${kind}`);
}

function isCertificate(kind: CredentialKind): boolean {
  return kind === "certificate" || kind === "samlSigning";
}

export function credentialInput(
  draft: CredentialDraft,
): { ok: true; value: CredentialInput } | { ok: false; field: "secret" | "expiresOn" } {
  if (draft.kind === "certificate" || draft.kind === "samlSigning") {
    return { ok: true, value: { kind: draft.kind, validDays: draft.validDays } };
  }
  if (draft.kind === "bindPassword") {
    if (!directoryPasswordSchema.safeParse(draft.secret).success) return { ok: false, field: "secret" };
    return { ok: true, value: { kind: "bindPassword", secret: draft.secret } };
  }
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

export function fileNameOf(name: string, extension: string): string {
  return `${name.replace(/[^\w.-]+/g, "-").toLowerCase()}.${extension}`;
}

export function downloadFile(content: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadCertificate(pem: string, name: string): void {
  downloadFile(pem, fileNameOf(name, "pem"), "application/x-pem-file");
}

export function CredentialFields({
  draft,
  onChange,
  invalid,
  kinds = ["clientSecret", "certificate"],
  kindLabel,
}: {
  draft: CredentialDraft;
  onChange: (draft: CredentialDraft) => void;
  invalid: "secret" | "expiresOn" | null;
  kinds?: CredentialKind[];
  kindLabel?: (kind: CredentialKind) => string;
}) {
  const { t } = useTranslation();
  const label = kindLabel ?? ((kind: CredentialKind) => t(`identityProviders.credentials.kinds.${kind}`));
  return (
    <div className="flex flex-col gap-4">
      {kinds.length > 1 ? (
        <SegmentedControl
          label={t("identityProviders.credentials.kind")}
          value={draft.kind}
          onValueChange={(kind) => onChange(emptyCredentialDraft(kind as CredentialKind))}
          options={kinds.map((kind) => ({ value: kind, label: label(kind) }))}
        />
      ) : null}
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
      ) : null}
      {draft.kind === "bindPassword" ? (
        <Field
          label={t("identityProviders.credentials.bindPassword")}
          hint={t("identityProviders.credentials.bindPasswordHint")}
          {...(invalid === "secret" ? { error: t("validation.required") } : {})}
        >
          <PasswordInput
            autoComplete="new-password"
            value={draft.secret}
            onChange={(event) => onChange({ kind: "bindPassword", secret: event.target.value })}
          />
        </Field>
      ) : null}
      {draft.kind === "certificate" || draft.kind === "samlSigning" ? (
        <Field
          label={t("identityProviders.credentials.validity")}
          hint={
            draft.kind === "samlSigning"
              ? t("identityProviders.credentials.signingHint")
              : t("identityProviders.credentials.certificateHint")
          }
        >
          <Select
            aria-label={t("identityProviders.credentials.validity")}
            value={String(draft.validDays)}
            onValueChange={(value) => onChange({ kind: draft.kind, validDays: Number(value) })}
            options={CERTIFICATE_DAYS.map((days) => ({
              value: String(days),
              label: t("identityProviders.credentials.years", { count: days / 365 }),
            }))}
          />
        </Field>
      ) : null}
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
          {t(`identityProviders.credentials.noneDescriptions.${provider.type}`)}
        </Notice>
      ) : null}
      <List label={t("identityProviders.credentials.title")}>
        {credentials.map((credential, index) => (
          <ListRow
            key={credential.id}
            icon={isCertificate(credential.kind) ? FileKey2 : KeyRound}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {credentialKindLabel(t, provider, credential.kind)}
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
                {isCertificate(credential.kind) ? (
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
            {t(`identityProviders.credentials.addFor.${provider.type}`)}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-text-muted">
        {t(`identityProviders.credentials.renewHints.${provider.type}`)}
      </p>
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

export function CertificateCreated({ pem, name, kind }: { pem: string; name: string; kind: CredentialKind }) {
  const { t } = useTranslation();
  const signing = kind === "samlSigning";
  return (
    <div className="flex flex-col gap-3">
      <Notice
        variant="success"
        title={
          signing
            ? t("identityProviders.credentials.signingCreated")
            : t("identityProviders.credentials.certificateCreated")
        }
      >
        {signing
          ? t("identityProviders.credentials.signingUpload")
          : t("identityProviders.credentials.certificateUpload")}
      </Notice>
      <div>
        <Button variant="secondary" icon={Download} onClick={() => downloadCertificate(pem, name)}>
          {t("identityProviders.credentials.download")}
        </Button>
      </div>
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
  const kinds = credentialKinds(provider);
  const [draft, setDraft] = useState<CredentialDraft>(emptyCredentialDraft(kinds[0]));
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
      description={t(`identityProviders.credentials.addDescriptions.${provider.type}`)}
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
              {t(`identityProviders.credentials.saveFor.${provider.type}`)}
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
        <CertificateCreated pem={certificate} name={provider.name} kind={draft.kind} />
      ) : (
        <CredentialFields
          draft={draft}
          onChange={setDraft}
          invalid={invalid}
          kinds={kinds}
          kindLabel={(kind) => credentialKindLabel(t, provider, kind)}
        />
      )}
    </Dialog>
  );
}
