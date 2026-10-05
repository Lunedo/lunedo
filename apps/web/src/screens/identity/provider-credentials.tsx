import { clientSecretSchema, directoryPasswordSchema } from "@pagehall/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  DangerAction,
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
  chooseCredential,
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

export type CredentialGroup = "signing" | "graph";

const GROUP_KINDS: Record<CredentialGroup, CredentialKind[]> = {
  signing: ["samlSigning"],
  graph: ["clientSecret", "certificate"],
};

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

function expired(credential: ProviderCredential): boolean {
  return credential.expiresAt !== null && new Date(credential.expiresAt).getTime() <= Date.now();
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

export function CredentialsList({
  provider,
  canManage,
  group,
  removeInline = true,
}: {
  provider: IdentityProvider;
  canManage: boolean;
  group?: CredentialGroup;
  removeInline?: boolean;
}) {
  const { t } = useTranslation();
  const kinds = group ? GROUP_KINDS[group] : credentialKinds(provider);
  const texts = group === "graph" ? "graph" : provider.type;
  const format = useFormat();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProviderCredential | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const credentials = provider.credentials
    .filter((credential) => kinds.includes(credential.kind))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const refresh = () => queryClient.invalidateQueries({ queryKey: identityKeys.providers });
  const choose = async (credential: ProviderCredential, use: "this" | "newest") => {
    setChoosing(credential.id);
    try {
      await chooseCredential(provider.id, credential.id, use);
      await refresh();
    } catch (failure) {
      showFailure(t("failures.chooseCredential"), failure, () => void choose(credential, use));
    } finally {
      setChoosing(null);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {credentials.length === 0 && texts !== "graph" ? (
        <Notice variant="danger" title={t("identityProviders.credentials.noneTitle")}>
          {t(`identityProviders.credentials.noneDescriptions.${texts}`)}
        </Notice>
      ) : null}
      <List
        label={t(
          group
            ? `identityProviders.credentials.groupTitles.${group}`
            : "identityProviders.credentials.title",
        )}
      >
        {credentials.map((credential) => (
          <ListRow
            key={credential.id}
            icon={isCertificate(credential.kind) ? FileKey2 : KeyRound}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {credentialKindLabel(t, provider, credential.kind)}
                {credential.inUse && credentials.length > 1 ? (
                  <Badge variant="accent">
                    {credential.chosen
                      ? t("identityProviders.credentials.inUseChosen")
                      : t("identityProviders.credentials.newest")}
                  </Badge>
                ) : null}
                {expired(credential) ? (
                  <Badge variant="danger">{t("identityProviders.credentials.expired")}</Badge>
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
                {canManage && !credential.inUse && !expired(credential) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={choosing === credential.id}
                    onClick={() => void choose(credential, "this")}
                  >
                    {t("identityProviders.credentials.useThis")}
                  </Button>
                ) : null}
                {canManage && credential.chosen ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={choosing === credential.id}
                    onClick={() => void choose(credential, "newest")}
                  >
                    {t("identityProviders.credentials.useNewest")}
                  </Button>
                ) : null}
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
                {canManage && removeInline ? (
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => setRemoving(credential)}>
                    {t("identityProviders.credentials.remove")}
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
            {t(`identityProviders.credentials.addFor.${texts}`)}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-text-muted">{t(`identityProviders.credentials.renewHints.${texts}`)}</p>
      {adding ? (
        <AddCredentialDialog
          provider={provider}
          kinds={kinds}
          texts={texts}
          onClose={() => setAdding(false)}
          onAdded={() => void refresh()}
        />
      ) : null}
      <RemoveCredentialDialog provider={provider} credential={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

function RemoveCredentialDialog({
  provider,
  credential,
  onClose,
}: {
  provider: IdentityProvider;
  credential: ProviderCredential | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  return (
    <ConfirmDialog
      open={credential !== null}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={t("identityProviders.credentials.removeTitle")}
      description={credential ? removalEffect(t, provider, credential) : undefined}
      confirmLabel={t("identityProviders.credentials.remove")}
      cancelLabel={t("common.cancel")}
      destructive
      onConfirm={async () => {
        if (!credential) return;
        try {
          await removeCredential(provider.id, credential.id);
          onClose();
          await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
        } catch (failure) {
          showFailure(t("failures.removeCredential"), failure);
        }
      }}
    />
  );
}

function siblingKinds(provider: IdentityProvider, kind: CredentialKind): CredentialKind[] {
  const group = (Object.keys(GROUP_KINDS) as CredentialGroup[]).find(
    (candidate) => provider.type === "saml" && GROUP_KINDS[candidate].includes(kind),
  );
  return group ? GROUP_KINDS[group] : credentialKinds(provider);
}

function removalEffect(t: TFunction, provider: IdentityProvider, credential: ProviderCredential): string {
  if (!credential.inUse) return t("identityProviders.credentials.removeUnused");
  const kinds = siblingKinds(provider, credential.kind);
  const others = provider.credentials.filter(
    (other) => other.id !== credential.id && kinds.includes(other.kind) && !expired(other),
  );
  return others.length === 0
    ? t("identityProviders.credentials.removeLast", { name: provider.name })
    : t("identityProviders.credentials.removeInUse");
}

export function CredentialRemovalZone({ provider }: { provider: IdentityProvider }) {
  const { t } = useTranslation();
  const format = useFormat();
  const [removing, setRemoving] = useState<ProviderCredential | null>(null);
  const credentials = [...provider.credentials].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (credentials.length === 0) return null;
  return (
    <>
      {credentials.map((credential) => (
        <DangerAction
          key={credential.id}
          title={t("identityProviders.credentials.removeEntry", {
            kind: credentialKindLabel(t, provider, credential.kind),
            created: format.date(credential.createdAt),
          })}
          description={removalEffect(t, provider, credential)}
          action={
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => setRemoving(credential)}>
              {t("identityProviders.credentials.remove")}
            </Button>
          }
        />
      ))}
      <RemoveCredentialDialog provider={provider} credential={removing} onClose={() => setRemoving(null)} />
    </>
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
  kinds,
  texts,
  onClose,
  onAdded,
}: {
  provider: IdentityProvider;
  kinds: CredentialKind[];
  texts: IdentityProvider["type"] | "graph";
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
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
      description={t(`identityProviders.credentials.addDescriptions.${texts}`)}
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
              {t(`identityProviders.credentials.saveFor.${texts}`)}
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
