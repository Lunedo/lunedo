import { emailSchema, graphMailConfigurationSchema } from "@pagehall/shared";
import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Field,
  focusFirstInvalidSoon,
  Input,
  List,
  ListRow,
  Notice,
  PasswordInput,
  SegmentedControl,
  Select,
  useToast,
} from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Download, FileKey2, KeyRound, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { instanceKeys } from "../api/instance-queries.js";
import { request } from "../api/request.js";
import { useFailureToast } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { isLanguage } from "../i18n/index.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { downloadText } from "./download.js";

export interface GraphMailSettings {
  tenantId: string;
  clientId: string;
  sender: string;
  senderName: string | null;
  authority: string;
  graphUrl: string;
}

export interface GraphCredential {
  id: string;
  kind: "clientSecret" | "certificate";
  keyId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const CERTIFICATE_DAYS = [365, 730, 1095] as const;

export function graphErrorText(t: TFunction, code: string | null): { cause: string; action: string } {
  const known = code?.startsWith("graph") ?? false;
  return {
    cause: known ? translateKey(t, `mail.graphErrors.${code}.cause`) : t("mail.testFailedUnknown"),
    action: known ? translateKey(t, `mail.graphErrors.${code}.action`) : t("mail.testFailedAction"),
  };
}

export function GraphMailForm({
  initial,
  credentials,
  active,
  defaultRecipient,
}: {
  initial: GraphMailSettings | null;
  credentials: GraphCredential[];
  active: boolean;
  defaultRecipient: string;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    tenantId: initial?.tenantId ?? "",
    clientId: initial?.clientId ?? "",
    sender: initial?.sender ?? "",
    senderName: initial?.senderName ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ delivered: boolean; code: string | null } | null>(null);
  const [adding, setAdding] = useState<"clientSecret" | "certificate" | null>(null);
  const [removing, setRemoving] = useState<GraphCredential | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: instanceKeys.mail });
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }));

  const body = () => {
    const parsed = graphMailConfigurationSchema.safeParse({
      tenantId: values.tenantId,
      clientId: values.clientId,
      sender: values.sender,
      senderName: values.senderName.trim() === "" ? null : values.senderName,
      ...(initial ? { authority: initial.authority, graphUrl: initial.graphUrl } : {}),
    });
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    focusFirstInvalidSoon();
    setErrors(
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.path[0] === "tenantId"
            ? t("identityProviders.fields.tenantIdInvalid")
            : issue.path[0] === "sender"
              ? t("validation.email")
              : t("validation.required"),
        ]),
      ),
    );
    return null;
  };

  const save = async () => {
    const configuration = body();
    if (!configuration) return;
    setSaving(true);
    setError(null);
    try {
      await request(() => api.PUT("/api/v1/instance/mail/graph", { body: configuration }));
      if (credentials.length > 0) {
        await request(() => api.PUT("/api/v1/instance/mail/method", { body: { method: "graph" } }));
      }
      await refresh();
      toast({
        title: credentials.length > 0 ? t("mail.graph.savedActive") : t("mail.graph.savedNeedsCredential"),
        variant: "success",
      });
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTestResult(null);
    const configuration = body();
    if (!configuration) return;
    if (!emailSchema.safeParse(recipient).success) {
      setErrors((current) => ({ ...current, recipient: t("validation.email") }));
      return;
    }
    setTesting(true);
    try {
      const result = await request(() =>
        api.POST("/api/v1/instance/mail/graph/test", {
          body: { to: recipient, language: isLanguage(i18n.language) ? i18n.language : "en", configuration },
        }),
      );
      setTestResult({ delivered: result.delivered, code: result.error?.code ?? null });
    } catch (failure) {
      setTestResult({ delivered: false, code: null });
      showFailure(t("mail.testFailed"), failure);
    } finally {
      setTesting(false);
    }
  };

  const failure = testResult && !testResult.delivered ? graphErrorText(t, testResult.code) : null;

  return (
    <div className="flex flex-col gap-4">
      <Notice variant="info" title={t("mail.graph.steps.title")}>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>{t("mail.graph.steps.create")}</li>
          <li>{t("mail.graph.steps.grant")}</li>
          <li>
            {t("mail.graph.steps.restrict")}
            <span className="mt-1 block text-sm text-text-muted">{t("mail.graph.steps.restrictNote")}</span>
          </li>
          <li>{t("mail.graph.steps.enter")}</li>
        </ol>
      </Notice>
      {error ? (
        <Notice variant="danger" title={t("failures.saveMail")}>
          {error}
        </Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("identityProviders.fields.tenantId")}
          {...(errors.tenantId ? { error: errors.tenantId } : {})}
        >
          <Input
            className="font-mono"
            value={values.tenantId}
            onChange={(event) => set({ tenantId: event.target.value })}
          />
        </Field>
        <Field
          label={t("identityProviders.fields.clientId")}
          {...(errors.clientId ? { error: errors.clientId } : {})}
        >
          <Input
            className="font-mono"
            value={values.clientId}
            onChange={(event) => set({ clientId: event.target.value })}
          />
        </Field>
        <Field
          label={t("mail.graph.sender")}
          hint={t("mail.graph.senderHint")}
          {...(errors.sender ? { error: errors.sender } : {})}
        >
          <Input
            type="email"
            value={values.sender}
            onChange={(event) => set({ sender: event.target.value })}
          />
        </Field>
        <Field label={t("mail.graph.senderName")} hint={t("mail.graph.senderNameHint")}>
          <Input value={values.senderName} onChange={(event) => set({ senderName: event.target.value })} />
        </Field>
      </div>
      <p className="text-sm text-text-muted">{t("mail.graph.sentItems")}</p>
      <div className="flex flex-col gap-2">
        <span className="font-medium">{t("mail.graph.credentials")}</span>
        {credentials.length === 0 ? (
          <p className="text-sm text-text-muted">{t("mail.graph.noCredentials")}</p>
        ) : (
          <List label={t("mail.graph.credentials")}>
            {credentials.map((credential) => (
              <ListRow
                key={credential.id}
                icon={credential.kind === "certificate" ? FileKey2 : KeyRound}
                title={t(`mail.graph.kinds.${credential.kind}`)}
                description={
                  credential.expiresAt
                    ? t("mail.graph.expires", { date: format.date(credential.expiresAt) })
                    : t("mail.graph.noExpiry")
                }
                actions={
                  <div className="flex flex-wrap gap-2">
                    {credential.kind === "certificate" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Download}
                        onClick={() =>
                          globalThis.location.assign(
                            `/api/v1/instance/mail/graph/credentials/${credential.id}/certificate`,
                          )
                        }
                      >
                        {t("mail.graph.downloadCertificate")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Trash2}
                      onClick={() => setRemoving(credential)}
                    >
                      {t("common.removeCredential")}
                    </Button>
                  </div>
                }
              />
            ))}
          </List>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding("clientSecret")}>
            {t("mail.graph.addSecret")}
          </Button>
          <Button size="sm" variant="secondary" icon={FileKey2} onClick={() => setAdding("certificate")}>
            {t("mail.graph.createCertificate")}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <Field label={t("mail.testRecipient")} {...(errors.recipient ? { error: errors.recipient } : {})}>
          <Input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" icon={Send} loading={testing} onClick={() => void test()}>
            {t("mail.sendTest")}
          </Button>
        </div>
        {testResult?.delivered ? (
          <div role="status" className="flex flex-col gap-1">
            <span className="text-success">{t("mail.testDeliveredGraph")}</span>
            <span className="text-sm text-text-muted">{t("mail.testDeliveryFollowsGraph")}</span>
          </div>
        ) : null}
        {failure ? (
          <ErrorState
            title={t("mail.testFailed")}
            cause={failure.cause}
            action={failure.action}
            onRetry={() => void test()}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-text-muted">
          {active ? t("mail.graph.active") : t("mail.saveTogether")}
        </span>
        <Button variant="primary" loading={saving} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
      {adding ? (
        <AddCredentialDialog
          kind={adding}
          onClose={() => setAdding(null)}
          onAdded={async (certificate) => {
            setAdding(null);
            await refresh();
            if (certificate) downloadText("pagehall-mail.pem", certificate, "application/x-pem-file");
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("mail.graph.removeTitle")}
        description={t("mail.graph.removeDescription")}
        confirmLabel={t("common.removeCredential")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/instance/mail/graph/credentials/{credentialId}", {
                params: { path: { credentialId: removing.id } },
              }),
            );
            setRemoving(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.removeMailCredential"), failure);
          }
        }}
      />
    </div>
  );
}

function AddCredentialDialog({
  kind,
  onClose,
  onAdded,
}: {
  kind: "clientSecret" | "certificate";
  onClose: () => void;
  onAdded: (certificate: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(kind);
  const [secret, setSecret] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [validDays, setValidDays] = useState<string>("730");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (mode === "clientSecret" && secret.trim() === "") {
      setError(t("validation.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const added = await request(() =>
        api.POST("/api/v1/instance/mail/graph/credentials", {
          body:
            mode === "clientSecret"
              ? {
                  kind: "clientSecret",
                  secret,
                  expiresAt: expiresOn ? new Date(`${expiresOn}T00:00:00Z`).toISOString() : null,
                }
              : { kind: "certificate", validDays: Number(validDays) },
        }),
      );
      await onAdded(added.certificate);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("mail.graph.addTitle")}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {mode === "clientSecret" ? t("mail.graph.addSecret") : t("mail.graph.createCertificate")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          label={t("mail.graph.kind")}
          value={mode}
          onValueChange={(value) => setMode(value as typeof mode)}
          options={(["clientSecret", "certificate"] as const).map((value) => ({
            value,
            label: t(`mail.graph.kinds.${value}`),
          }))}
        />
        {error ? (
          <Notice variant="danger" title={t("failures.addMailCredential")}>
            {error}
          </Notice>
        ) : null}
        {mode === "clientSecret" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("identityProviders.credentials.secret")}>
              <PasswordInput
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </Field>
            <Field label={t("identityProviders.credentials.expiresOn")} hint={t("mail.graph.expiresHint")}>
              <Input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label={t("mail.graph.validity")} hint={t("mail.graph.certificateHint")}>
            <Select
              aria-label={t("mail.graph.validity")}
              value={validDays}
              onValueChange={setValidDays}
              options={CERTIFICATE_DAYS.map((days) => ({
                value: String(days),
                label: t("mail.graph.years", { count: days / 365 }),
              }))}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
