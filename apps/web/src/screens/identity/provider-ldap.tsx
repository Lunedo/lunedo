import {
  activeDirectoryServiceAccountSchema,
  caCertificateSchema,
  distinguishedNameSchema,
  ldapSecondFactorModes,
  ldapServerAddress,
} from "@pagehall/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Notice,
  Section,
  Select,
  SettingRow,
  Switch,
} from "@pagehall/ui";
import { CircleCheck, CircleMinus, CircleX, FileUp, Lock, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  type DirectoryTestResult,
  type DirectoryTestStep,
  type LdapConfigInput,
  type LdapProvider,
  removeCaCertificate,
  setCaCertificate,
  testDirectory,
} from "../../api/identity-queries.js";
import {
  AutoSaveTextField,
  ExplicitSaveTextField,
  SaveIndicator,
  type SaveTracker,
  useSaveStates,
} from "../../components/auto-save.js";
import { useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { FileButton, readFileText } from "./file-button.js";
import { ldapConfigInput, useCheckedUpdate, useLdapUpdate, useStoreProvider } from "./provider-config.js";
import { Entry, ReceivedClaims } from "./provider-test.js";

export const CERTIFICATE_TYPES = ".pem,.crt,.cer,application/x-pem-file,application/x-x509-ca-cert";

export const ldapUrlSchema = z.string().refine((value) => ldapServerAddress(value) !== null);

export const ldapFilterSchema = z
  .string()
  .trim()
  .min(3)
  .max(1000)
  .refine((value) => {
    if (!value.startsWith("(") || !value.endsWith(")")) return false;
    let depth = 0;
    for (const character of value) {
      if (character === "(") depth++;
      if (character === ")") depth--;
      if (depth < 0) return false;
    }
    return depth === 0;
  });

const ldapAttribute = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^(?:[A-Za-z][A-Za-z0-9-]*|[0-9]+(?:\.[0-9]+)+)$/);

export function serviceAccountField(preset: LdapConfigInput["preset"]) {
  return preset === "activeDirectory"
    ? ({
        schema: activeDirectoryServiceAccountSchema,
        hint: "identityProviders.ldap.bindDnHintActiveDirectory",
        invalid: "identityProviders.ldap.serviceAccountInvalid",
      } as const)
    : ({
        schema: distinguishedNameSchema,
        hint: "identityProviders.ldap.bindDnHint",
        invalid: "identityProviders.ldap.dnInvalid",
      } as const);
}

export function isPlainLdap(url: string): boolean {
  return ldapServerAddress(url)?.startsWith("ldap://") ?? false;
}

export const SIGN_IN_ATTRIBUTES = {
  activeDirectory: ["userPrincipalName", "sAMAccountName", "mail"],
  generic: ["mail", "uid"],
} as const;

export function LdapConnectionFields({
  provider,
  canManage,
}: {
  provider: LdapProvider;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const checked = useCheckedUpdate(provider, () => ldapConfigInput(provider.config));
  const tracker = useSaveStates();
  const config = provider.config;
  const plain = isPlainLdap(config.url);
  const serviceAccount = serviceAccountField(config.preset);
  return (
    <>
      <div className="px-4 py-3">
        <ExplicitSaveTextField
          label={t("identityProviders.ldap.url")}
          hint={t("identityProviders.ldap.urlHint")}
          value={config.url}
          schema={config.startTls ? ldapUrlSchema.refine(isPlainLdap) : ldapUrlSchema}
          invalidMessage={
            config.startTls
              ? t("identityProviders.ldap.urlInvalidStartTls")
              : t("identityProviders.ldap.urlInvalid")
          }
          disabled={!canManage}
          className="font-mono"
          secret={{
            label: t("identityProviders.check.serverPassword"),
            hint: t("identityProviders.check.serverPasswordHint"),
          }}
          onSave={(url, password) =>
            checked((current) => ({ ...current, url: ldapServerAddress(url) ?? url }), password)
          }
        />
      </div>
      <SettingRow
        label={t("identityProviders.ldap.startTls")}
        description={
          plain ? t("identityProviders.ldap.startTlsHint") : t("identityProviders.ldap.startTlsLdaps")
        }
        control={
          <Switch
            label={t("identityProviders.ldap.startTls")}
            labelHidden
            checked={config.startTls}
            disabled={!canManage || !plain}
            {...(canManage && plain
              ? {}
              : {
                  disabledReason: canManage
                    ? t("identityProviders.ldap.startTlsLdaps")
                    : t("identityProviders.noPermission"),
                })}
            onCheckedChange={(startTls) =>
              void tracker("startTls").run(() => checked((current) => ({ ...current, startTls })))
            }
          />
        }
        status={<SaveIndicator tracker={tracker("startTls")} />}
      />
      <div className="grid grid-cols-1 gap-4 px-4 py-3 sm:grid-cols-2">
        <ExplicitSaveTextField
          label={t("identityProviders.ldap.bindDn")}
          hint={t(serviceAccount.hint)}
          value={config.bindDn}
          schema={serviceAccount.schema}
          invalidMessage={t(serviceAccount.invalid)}
          disabled={!canManage}
          className="font-mono"
          onSave={(bindDn) => checked((current) => ({ ...current, bindDn }))}
        />
        {(["userBaseDn", "groupBaseDn"] as const).map((field) => (
          <ExplicitSaveTextField
            key={field}
            label={t(`identityProviders.ldap.${field}`)}
            hint={t(`identityProviders.ldap.${field}Hint`)}
            value={config[field]}
            schema={distinguishedNameSchema}
            invalidMessage={t("identityProviders.ldap.dnInvalid")}
            disabled={!canManage}
            className="font-mono"
            onSave={(value) => checked((current) => ({ ...current, [field]: value }))}
          />
        ))}
        {(["userFilter", "groupFilter"] as const).map((field) => (
          <ExplicitSaveTextField
            key={field}
            label={t(`identityProviders.ldap.${field}`)}
            hint={t(`identityProviders.ldap.${field}Hint`)}
            value={config[field]}
            schema={ldapFilterSchema}
            invalidMessage={t("identityProviders.ldap.filterInvalid")}
            disabled={!canManage}
            className="font-mono"
            onSave={(value) => checked((current) => ({ ...current, [field]: value }))}
          />
        ))}
      </div>
    </>
  );
}

export function useCaCertificateUpload(provider: LdapProvider) {
  const { t } = useTranslation();
  const store = useStoreProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const pem = await readFileText(file);
      if (!caCertificateSchema.safeParse(pem).success) {
        setError(t("problems.invalidCertificate"));
        return false;
      }
      store(await setCaCertificate(provider.id, pem));
      return true;
    } catch (failure) {
      setError(problemMessage(t, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, upload };
}

export function CaCertificateUpload({
  provider,
  onUploaded,
}: {
  provider: LdapProvider;
  onUploaded?: () => void;
}) {
  const { t } = useTranslation();
  const ca = useCaCertificateUpload(provider);
  return (
    <div className="flex flex-col items-start gap-2">
      <FileButton
        label={
          provider.ldap.caCertificate
            ? t("identityProviders.ldap.caReplace")
            : t("identityProviders.ldap.caUpload")
        }
        accept={CERTIFICATE_TYPES}
        icon={FileUp}
        variant="secondary"
        busy={ca.busy}
        onFile={(file) =>
          void ca.upload(file).then((uploaded) => {
            if (uploaded) onUploaded?.();
          })
        }
      />
      {ca.error ? (
        <Notice variant="danger" title={t("failures.uploadCaCertificate")}>
          {ca.error}
        </Notice>
      ) : null}
    </div>
  );
}

export function CaCertificateSection({
  provider,
  canManage,
}: {
  provider: LdapProvider;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const store = useStoreProvider();
  const showFailure = useFailureToast();
  const [removing, setRemoving] = useState(false);
  const certificate = provider.ldap.caCertificate;
  return (
    <Section title={t("identityProviders.ldap.caTitle")}>
      <p className="px-4 pt-3 text-sm text-text-muted">{t("identityProviders.ldap.caDescription")}</p>
      {certificate ? (
        <>
          <SettingRow
            label={t("identityProviders.certificate.subject")}
            control={<span className="break-all text-sm">{certificate.subject}</span>}
          />
          <SettingRow
            label={t("identityProviders.certificate.fingerprint")}
            control={<span className="break-all font-mono text-sm">{certificate.fingerprint}</span>}
          />
          <SettingRow
            label={t("identityProviders.certificate.expiresAt")}
            control={
              <Badge variant={provider.warnings.includes("caCertificateExpiring") ? "warning" : "neutral"}>
                {t("identityProviders.certificate.validUntil", { date: format.date(certificate.expiresAt) })}
              </Badge>
            }
          />
        </>
      ) : (
        <SettingRow
          label={t("identityProviders.ldap.caNone")}
          description={t("identityProviders.ldap.caNoneHint")}
          control={<span className="text-text-muted">{t("identityProviders.ldap.caSystem")}</span>}
        />
      )}
      {canManage ? (
        <div className="flex flex-wrap items-start gap-2 px-4 py-3">
          <CaCertificateUpload provider={provider} />
          {certificate ? (
            <Button variant="danger" icon={Trash2} onClick={() => setRemoving(true)}>
              {t("identityProviders.ldap.caRemove")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("identityProviders.ldap.caRemoveTitle")}
        description={t("identityProviders.ldap.caRemoveDescription")}
        confirmLabel={t("common.removeCertificate")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          try {
            store(await removeCaCertificate(provider.id));
            setRemoving(false);
          } catch (failure) {
            showFailure(t("failures.removeCaCertificate"), failure);
          }
        }}
      />
    </Section>
  );
}

export function LdapAttributeFields({
  provider,
  canManage,
  onUploadCertificate,
}: {
  provider: LdapProvider;
  canManage: boolean;
  onUploadCertificate: () => void;
}) {
  const { t } = useTranslation();
  const update = useLdapUpdate(provider);
  const tracker = useSaveStates();
  const config = provider.config;
  const options = SIGN_IN_ATTRIBUTES[config.preset];
  const [found, setFound] = useState<FoundAttribute[]>([]);
  return (
    <>
      <SettingRow
        label={t("identityProviders.attributes.identifier")}
        description={t("identityProviders.attributes.identifierHint")}
        meta={t("identityProviders.attributes.fixed")}
        control={
          <Badge variant="neutral" icon={Lock}>
            {t(`identityProviders.attributes.identifiers.ldap.${config.preset}`)}
          </Badge>
        }
      />
      <SettingRow
        label={t("identityProviders.ldap.signInAttribute")}
        description={t("identityProviders.ldap.signInAttributeHint")}
        control={
          <Select
            aria-label={t("identityProviders.ldap.signInAttribute")}
            value={config.signInAttribute}
            disabled={!canManage}
            onValueChange={(value) =>
              void tracker("signInAttribute").run(() =>
                update((current) => withSignInAttribute(current, value)),
              )
            }
            options={options.map((value) => ({
              value,
              label: t(`identityProviders.ldap.signInAttributes.${value}`),
            }))}
          />
        }
        status={<SaveIndicator tracker={tracker("signInAttribute")} />}
      />
      <div className="px-4 py-3">
        <TestPersonLookup provider={provider} onFound={setFound} onUploadCertificate={onUploadCertificate} />
      </div>
      {config.preset === "activeDirectory"
        ? (["email", "displayName"] as const).map((attribute) => (
            <AttributeSelect
              key={attribute}
              label={t(`identityProviders.ldap.attributes.${attribute}`)}
              value={config.attributes[attribute]}
              found={found}
              disabled={!canManage}
              tracker={tracker(attribute)}
              onSave={(value) =>
                update((current) =>
                  current.preset === "activeDirectory"
                    ? { ...current, attributes: { ...config.attributes, [attribute]: value } }
                    : current,
                )
              }
            />
          ))
        : null}
      {config.preset === "generic" ? (
        <>
          {(["email", "signInName", "displayName"] as const).map((attribute) => (
            <AttributeSelect
              key={attribute}
              label={t(`identityProviders.ldap.attributes.${attribute}`)}
              value={config.attributes[attribute]}
              found={found}
              disabled={!canManage}
              tracker={tracker(attribute)}
              onSave={(value) =>
                update((current) =>
                  current.preset === "generic"
                    ? { ...current, attributes: { ...config.attributes, [attribute]: value } }
                    : current,
                )
              }
            />
          ))}
          <div className="grid grid-cols-1 gap-4 px-4 py-3 sm:grid-cols-2">
            <AutoSaveTextField
              label={t("identityProviders.ldap.attributes.groupName")}
              value={config.attributes.groupName}
              schema={ldapAttribute}
              invalidMessage={t("identityProviders.ldap.attributeInvalid")}
              disabled={!canManage}
              className="font-mono"
              onSave={(value) =>
                update((current) =>
                  current.preset === "generic"
                    ? { ...current, attributes: { ...config.attributes, groupName: value } }
                    : current,
                )
              }
            />
          </div>
          <SettingRow
            label={t("identityProviders.ldap.groupMembership")}
            description={t("identityProviders.ldap.groupMembershipHint")}
            control={
              <Select
                aria-label={t("identityProviders.ldap.groupMembership")}
                value={config.groupMembership}
                disabled={!canManage}
                onValueChange={(value) =>
                  void tracker("membership").run(() =>
                    update((current) =>
                      current.preset === "generic"
                        ? { ...current, groupMembership: value as "member" | "memberOf" }
                        : current,
                    ),
                  )
                }
                options={(["member", "memberOf"] as const).map((value) => ({
                  value,
                  label: t(`identityProviders.ldap.memberships.${value}`),
                }))}
              />
            }
            status={<SaveIndicator tracker={tracker("membership")} />}
          />
          <DisabledAttributeFields provider={provider} canManage={canManage} />
        </>
      ) : null}
    </>
  );
}

interface FoundAttribute {
  name: string;
  example: string | null;
}

function AttributeSelect({
  label,
  value,
  found,
  disabled,
  tracker,
  onSave,
}: {
  label: string;
  value: string;
  found: FoundAttribute[];
  disabled: boolean;
  tracker: SaveTracker;
  onSave: (value: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const names = new Map<string, FoundAttribute>();
  for (const attribute of [{ name: value, example: null }, ...found]) {
    const key = attribute.name.toLowerCase();
    const known = names.get(key);
    names.set(key, { name: known?.name ?? attribute.name, example: known?.example ?? attribute.example });
  }
  const fromDirectory = found.find((attribute) => attribute.name.toLowerCase() === value.toLowerCase());
  return (
    <SettingRow
      label={label}
      description={
        found.length === 0
          ? t("identityProviders.ldap.attributeChoiceHint")
          : fromDirectory
            ? t("identityProviders.ldap.attributeExample", { value: fromDirectory.example ?? "" })
            : t("identityProviders.ldap.attributeNotReturned")
      }
      control={
        <Select
          aria-label={label}
          value={names.get(value.toLowerCase())?.name ?? value}
          disabled={disabled}
          onValueChange={(next) => void tracker.run(() => onSave(next))}
          options={[...names.values()].map((attribute) => ({
            value: attribute.name,
            label: attribute.name,
            ...(attribute.example ? { example: attribute.example } : {}),
          }))}
        />
      }
      status={<SaveIndicator tracker={tracker} />}
    />
  );
}

function TestPersonLookup({
  provider,
  onFound,
  onUploadCertificate,
}: {
  provider: LdapProvider;
  onFound: (attributes: FoundAttribute[]) => void;
  onUploadCertificate: () => void;
}) {
  const { t } = useTranslation();
  const [signInName, setSignInName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{
    title: string;
    detail: string | null;
    action: string;
    certificate: boolean;
  } | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    setFound(null);
    try {
      const result = await testDirectory(provider.id, signInName.trim() === "" ? null : signInName.trim());
      const failed = result.steps.find((step) => !step.ok);
      if (failed?.step === "search" && result.searched) {
        const { attribute, value } = result.searched;
        onFound([]);
        setProblem({
          title: t("identityProviders.ldap.noMatchTitle"),
          detail: t("identityProviders.ldap.noMatch", { attribute, value }),
          action:
            (attribute === "mail" || attribute === "userPrincipalName") && !value.includes("@")
              ? t("identityProviders.ldap.noMatchAddress", { attribute })
              : t("identityProviders.ldap.noMatchOther"),
          certificate: false,
        });
        return;
      }
      if (failed) {
        onFound([]);
        setProblem({
          title: t("identityProviders.directoryTest.failed", {
            step: t(`identityProviders.directoryTest.steps.${failed.step}`),
          }),
          detail: failed.detail,
          action: t(`identityProviders.directoryTest.actions.${failed.step}`),
          certificate: failed.step === "certificate",
        });
        return;
      }
      const attributes = result.attributes.map((attribute) => ({
        name: attribute.name,
        example: attribute.values[0] ?? null,
      }));
      const sample = result.sample;
      const person = sample?.displayName ?? sample?.signInName ?? sample?.email ?? sample?.subject ?? "";
      setFound(
        result.searched
          ? t("identityProviders.ldap.attributesRead", { count: attributes.length, person })
          : t("identityProviders.ldap.attributesReadFirst", { count: attributes.length, person }),
      );
      onFound(attributes);
    } catch (failure) {
      setProblem({
        title: t("failures.testDirectory"),
        detail: null,
        action: problemMessage(t, failure),
        certificate: false,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field
            label={t("identityProviders.ldap.testPerson")}
            hint={t("identityProviders.ldap.testPersonHint")}
          >
            <Input value={signInName} onChange={(event) => setSignInName(event.target.value)} />
          </Field>
        </div>
        <Button variant="secondary" loading={busy} onClick={() => void run()}>
          {t("identityProviders.ldap.readAttributes")}
        </Button>
      </div>
      {problem ? (
        <Notice variant={problem.certificate ? "warning" : "danger"} title={problem.title}>
          <div className="flex flex-col gap-2">
            {problem.detail ? <p>{problem.detail}</p> : null}
            <p>{problem.action}</p>
            {problem.certificate ? (
              <button
                type="button"
                className="self-start font-medium text-accent hover:underline focus-visible:focus-ring"
                onClick={onUploadCertificate}
              >
                {t("identityProviders.ldap.goToCaUpload")}
              </button>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {found ? <Notice variant="success">{found}</Notice> : null}
    </div>
  );
}

function withSignInAttribute(current: LdapConfigInput, value: string): LdapConfigInput {
  if (current.preset === "activeDirectory") {
    return {
      ...current,
      signInAttribute: value as (typeof SIGN_IN_ATTRIBUTES.activeDirectory)[number],
    };
  }
  return { ...current, signInAttribute: value as (typeof SIGN_IN_ATTRIBUTES.generic)[number] };
}

const valueList = z.string().refine((value) => {
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length <= 20 && values.every((entry) => entry.length <= 256);
});

function DisabledAttributeFields({ provider, canManage }: { provider: LdapProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = useLdapUpdate(provider);
  const config = provider.config;
  if (config.preset !== "generic") return null;
  const disabled = config.disabled;
  const save = (next: { attribute: string; values: string[] } | null) =>
    update((current) => (current.preset === "generic" ? { ...current, disabled: next } : current));
  return (
    <div className="grid grid-cols-1 gap-4 px-4 py-3 sm:grid-cols-2">
      <AutoSaveTextField
        label={t("identityProviders.ldap.disabledAttribute")}
        hint={t("identityProviders.ldap.disabledAttributeHint")}
        value={disabled?.attribute ?? ""}
        schema={z.union([z.literal(""), ldapAttribute])}
        invalidMessage={t("identityProviders.ldap.attributeInvalid")}
        disabled={!canManage}
        className="font-mono"
        onSave={(attribute) => save(attribute === "" ? null : { attribute, values: disabled?.values ?? [] })}
      />
      {disabled ? (
        <AutoSaveTextField
          label={t("identityProviders.ldap.disabledValues")}
          hint={t("identityProviders.ldap.disabledValuesHint")}
          value={disabled.values.join(", ")}
          schema={valueList}
          invalidMessage={t("identityProviders.ldap.disabledValuesInvalid")}
          disabled={!canManage}
          className="font-mono"
          onSave={(value) =>
            save({
              attribute: disabled.attribute,
              values: value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
            })
          }
        />
      ) : null}
    </div>
  );
}

export function LdapSecondFactorFields({
  provider,
  canManage,
}: {
  provider: LdapProvider;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const update = useLdapUpdate(provider);
  const tracker = useSaveStates();
  const mode = provider.config.secondFactor.mode;
  return (
    <SettingRow
      label={t("identityProviders.secondFactor.mode")}
      description={t(`identityProviders.secondFactor.directoryHints.${mode}`)}
      control={
        <Select
          aria-label={t("identityProviders.secondFactor.mode")}
          value={mode}
          disabled={!canManage}
          onValueChange={(value) =>
            void tracker("secondFactor").run(() =>
              update((current) => ({
                ...current,
                secondFactor: { mode: value as (typeof ldapSecondFactorModes)[number] },
              })),
            )
          }
          options={ldapSecondFactorModes.map((value) => ({
            value,
            label: t(`identityProviders.secondFactor.directoryModes.${value}`),
          }))}
        />
      }
      status={<SaveIndicator tracker={tracker("secondFactor")} />}
    />
  );
}

const STEPS: DirectoryTestStep["step"][] = ["connection", "certificate", "serviceAccount", "search"];

export function DirectoryTest({ provider }: { provider: LdapProvider }) {
  const { t } = useTranslation();
  const [signInName, setSignInName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DirectoryTestResult | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await testDirectory(provider.id, signInName.trim() === "" ? null : signInName.trim()));
    } catch (failure) {
      setResult(null);
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field
            label={t("identityProviders.directoryTest.signInName")}
            hint={t("identityProviders.directoryTest.signInNameHint")}
          >
            <Input value={signInName} onChange={(event) => setSignInName(event.target.value)} />
          </Field>
        </div>
        <Button variant="primary" icon={Play} loading={busy} onClick={() => void run()}>
          {t("identityProviders.directoryTest.start")}
        </Button>
      </div>
      {error ? (
        <Notice variant="danger" title={t("failures.testDirectory")}>
          {error}
        </Notice>
      ) : null}
      {result ? (
        <DirectoryTestOutcome provider={provider} result={result} onRetry={() => void run()} />
      ) : null}
    </div>
  );
}

function DirectoryTestOutcome({
  provider,
  result,
  onRetry,
}: {
  provider: LdapProvider;
  result: DirectoryTestResult;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const failed = result.steps.find((step) => !step.ok) ?? null;
  const sample = result.sample;
  return (
    <div className="flex flex-col gap-4">
      {failed ? (
        <Notice
          variant="danger"
          title={t("identityProviders.directoryTest.failed", {
            step: t(`identityProviders.directoryTest.steps.${failed.step}`),
          })}
        >
          <div className="flex flex-col gap-2">
            {failed.detail ? <p>{failed.detail}</p> : null}
            <p>{t(`identityProviders.directoryTest.actions.${failed.step}`)}</p>
            {failed.step === "certificate" ? (
              <CaCertificateUpload provider={provider} onUploaded={onRetry} />
            ) : null}
          </div>
        </Notice>
      ) : (
        <Notice variant="success" title={t("identityProviders.directoryTest.worked")}>
          {t("identityProviders.directoryTest.workedDescription")}
        </Notice>
      )}
      <ul aria-label={t("identityProviders.directoryTest.checks")} className="flex flex-col gap-2">
        {STEPS.map((name) => {
          const step = result.steps.find((entry) => entry.step === name);
          const state = step ? (step.ok ? "ok" : "failed") : "skipped";
          const Icon = state === "ok" ? CircleCheck : state === "failed" ? CircleX : CircleMinus;
          return (
            <li key={name} className="flex items-center gap-2">
              <Icon
                aria-hidden="true"
                className={
                  state === "ok"
                    ? "size-icon-md shrink-0 text-success"
                    : state === "failed"
                      ? "size-icon-md shrink-0 text-danger"
                      : "size-icon-md shrink-0 text-text-muted"
                }
              />
              <span className="min-w-0 flex-1">{t(`identityProviders.directoryTest.steps.${name}`)}</span>
              <Badge variant={state === "ok" ? "success" : state === "failed" ? "danger" : "neutral"}>
                {t(`identityProviders.directoryTest.states.${state}`)}
              </Badge>
            </li>
          );
        })}
      </ul>
      {sample ? (
        <Section title={t("identityProviders.directoryTest.sample")}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
            <Entry label={t("identityProviders.test.subject")} value={sample.subject} mono />
            <Entry label={t("identityProviders.test.email")} value={sample.email ?? t("common.unknown")} />
            <Entry
              label={t("identityProviders.test.signInName")}
              value={sample.signInName ?? t("common.unknown")}
            />
            <Entry
              label={t("identityProviders.test.displayName")}
              value={sample.displayName ?? t("common.unknown")}
            />
            <Entry
              label={t("identityProviders.test.groups")}
              value={
                sample.groups && sample.groups.length > 0
                  ? sample.groups.map((group) => group.name ?? group.id).join(", ")
                  : t("identityProviders.test.noGroups")
              }
            />
          </dl>
        </Section>
      ) : null}
      {sample ? (
        <ReceivedClaims claims={result.attributes} title={t("identityProviders.directoryTest.attributes")} />
      ) : null}
    </div>
  );
}
