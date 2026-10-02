import {
  type AccessLevel,
  type Areas,
  instanceAreas,
  organizationAreas,
  tokenNameSchema,
} from "@pagehall/shared";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Notice,
  RadioGroup,
  SegmentedControl,
  useToast,
} from "@pagehall/ui";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { ApiToken } from "../api/account-queries.js";
import { problemMessage } from "../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../forms/use-schema-form.js";
import { translateKey } from "../i18n/translate.js";

const NONE = "none";
const EXPIRY_OPTIONS = ["never", "30", "90", "365", "custom"] as const;
const DAY_MS = 86_400_000;

type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

export function expiryChoices(maxLifetimeDays: number | null): ExpiryOption[] {
  return EXPIRY_OPTIONS.filter((option) => {
    if (maxLifetimeDays === null) return true;
    if (option === "never") return false;
    return option === "custom" || Number(option) <= maxLifetimeDays;
  });
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

const tokenForm = z.object({
  name: tokenNameSchema,
  expiry: z.enum(EXPIRY_OPTIONS),
  customDate: z.string(),
  instance: z.record(z.string(), z.enum(["none", "view", "manage"])),
  organization: z.record(z.string(), z.enum(["none", "view", "manage"])),
});

type TokenFormValues = z.input<typeof tokenForm>;

export interface TokenRequest {
  name: string;
  scopes: { instance?: Areas; organization?: Areas };
  expiresAt: string | null;
}

function pickAreas(values: Record<string, string>): Areas | undefined {
  const entries = Object.entries(values).filter(([, level]) => level !== NONE) as [string, AccessLevel][];
  return entries.length > 0 ? (Object.fromEntries(entries) as Areas) : undefined;
}

export function scopeSummary(t: Parameters<typeof translateKey>[0], scopes: ApiToken["scopes"]): string {
  const parts = [
    ...Object.entries(scopes.instance ?? {}).map(
      ([area, level]) =>
        `${translateKey(t, `areas.instance.${area}`)} (${translateKey(t, `areas.levels.${String(level)}`)})`,
    ),
    ...Object.entries(scopes.organization ?? {}).map(
      ([area, level]) =>
        `${translateKey(t, `areas.organization.${area}`)} (${translateKey(t, `areas.levels.${String(level)}`)})`,
    ),
  ];
  return parts.join(", ");
}

export function CreateTokenDialog({
  open,
  onOpenChange,
  allowInstance,
  allowOrganization,
  onCreate,
  hint,
  maxLifetimeDays,
}: {
  maxLifetimeDays: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowInstance: boolean;
  allowOrganization: boolean;
  onCreate: (request: TokenRequest) => Promise<{ token: string }>;
  hint?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(tokenForm, {
    defaultValues: {
      name: "",
      expiry: expiryChoices(maxLifetimeDays)[0] ?? "custom",
      customDate: dateInDays(Math.min(30, maxLifetimeDays ?? 30)),
      instance: Object.fromEntries(instanceAreas.map((area) => [area, NONE])),
      organization: Object.fromEntries(organizationAreas.map((area) => [area, NONE])),
    } as TokenFormValues,
  });

  const choices = expiryChoices(maxLifetimeDays);
  const latestDate = maxLifetimeDays === null ? undefined : dateInDays(maxLifetimeDays);

  useEffect(() => {
    const allowed = expiryChoices(maxLifetimeDays);
    if (!allowed.includes(form.getValues("expiry"))) form.setValue("expiry", allowed[0] ?? "custom");
  }, [maxLifetimeDays, form]);

  const close = (next: boolean) => {
    if (!next) {
      setSecret(null);
      setError(null);
      form.reset();
    }
    onOpenChange(next);
  };

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const instance = allowInstance ? pickAreas(values.instance) : undefined;
    const organization = allowOrganization ? pickAreas(values.organization) : undefined;
    if (!instance && !organization) {
      setError(t("tokens.scopeRequired"));
      return;
    }
    let expiresAt: string | null = null;
    if (values.expiry === "custom") {
      const date = new Date(`${values.customDate}T23:59:59`);
      if (
        !values.customDate ||
        Number.isNaN(date.getTime()) ||
        date.getTime() <= Date.now() ||
        (latestDate !== undefined && values.customDate > latestDate)
      ) {
        form.setError("customDate", {
          message:
            latestDate === undefined
              ? t("tokens.customDateFuture")
              : t("tokens.customDateWithin", { days: maxLifetimeDays ?? 0 }),
        });
        return;
      }
      expiresAt = date.toISOString();
    } else if (values.expiry !== "never") {
      expiresAt = new Date(Date.now() + Number(values.expiry) * DAY_MS).toISOString();
    }
    try {
      const created = await onCreate({
        name: values.name,
        scopes: { ...(instance ? { instance } : {}), ...(organization ? { organization } : {}) },
        expiresAt,
      });
      setSecret(created.token);
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });

  const levelOptions = [
    { value: NONE, label: t("areas.levels.none") },
    { value: "view", label: t("areas.levels.view") },
    { value: "manage", label: t("areas.levels.manage") },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={secret ? t("tokens.createdTitle") : t("tokens.createTitle")}
      size="md"
    >
      {secret ? (
        <div className="flex flex-col gap-4">
          <Notice variant="warning">{t("tokens.shownOnce")}</Notice>
          <code className="break-all rounded-md border border-border bg-surface-sunken p-3 font-mono text-sm">
            {secret}
          </code>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              icon={Copy}
              onClick={() => {
                navigator.clipboard.writeText(secret).then(
                  () => toast({ title: t("tokens.copied"), variant: "success" }),
                  () => toast({ title: t("common.copyFailed"), variant: "error" }),
                );
              }}
            >
              {t("common.copy")}
            </Button>
            <Button variant="primary" onClick={() => close(false)}>
              {t("common.done")}
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
          {error ? (
            <Notice variant="danger" title={t("failures.createToken")}>
              {error}
            </Notice>
          ) : null}
          <Field label={t("tokens.name")} error={form.formState.errors.name?.message}>
            <Input autoComplete="off" autoFocus {...form.register("name")} />
          </Field>
          {allowOrganization ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">{t("tokens.organizationAccess")}</legend>
              {organizationAreas.map((area) => (
                <AreaRow key={area} label={translateKey(t, `areas.organization.${area}`)}>
                  <Controller
                    control={form.control}
                    name={`organization.${area}`}
                    render={({ field }) => (
                      <SegmentedControl
                        label={translateKey(t, `areas.organization.${area}`)}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={levelOptions}
                      />
                    )}
                  />
                </AreaRow>
              ))}
            </fieldset>
          ) : null}
          {allowInstance ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">{t("tokens.instanceAccess")}</legend>
              {instanceAreas.map((area) => (
                <AreaRow key={area} label={translateKey(t, `areas.instance.${area}`)}>
                  <Controller
                    control={form.control}
                    name={`instance.${area}`}
                    render={({ field }) => (
                      <SegmentedControl
                        label={translateKey(t, `areas.instance.${area}`)}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={levelOptions}
                      />
                    )}
                  />
                </AreaRow>
              ))}
            </fieldset>
          ) : null}
          <p className="text-sm text-text-muted">{hint ?? t("tokens.neverMore")}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t("tokens.expires")}</legend>
            {maxLifetimeDays !== null ? (
              <p className="text-sm text-text-muted">
                {t("tokens.maximumApplies", { days: maxLifetimeDays })}
              </p>
            ) : null}
            <Controller
              control={form.control}
              name="expiry"
              render={({ field }) => (
                <RadioGroup
                  label={t("tokens.expires")}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={choices.map((value) => ({
                    value,
                    label: translateKey(t, `tokens.expiry.${value}`),
                  }))}
                />
              )}
            />
            {form.watch("expiry") === "custom" ? (
              <Field label={t("tokens.customDate")} error={form.formState.errors.customDate?.message}>
                <Input
                  type="date"
                  min={dateInDays(1)}
                  {...(latestDate ? { max: latestDate } : {})}
                  {...form.register("customDate")}
                />
              </Field>
            ) : null}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
              {t("tokens.create")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function AreaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>{label}</span>
      <div className="w-field max-w-full">{children}</div>
    </div>
  );
}

export function RevokeTokenDialog({
  token,
  onOpenChange,
  onRevoke,
}: {
  token: { name: string } | null;
  onOpenChange: (open: boolean) => void;
  onRevoke: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={token !== null}
      onOpenChange={onOpenChange}
      title={t("tokens.revokeTitle", { name: token?.name ?? "" })}
      description={t("tokens.revokeDescription")}
      confirmLabel={t("tokens.revoke")}
      cancelLabel={t("common.cancel")}
      destructive
      onConfirm={onRevoke}
    >
      <Notice variant="warning" title={t("access.losesAccess")}>
        {t("tokens.revokeImpact", { name: token?.name ?? "" })}
      </Notice>
    </ConfirmDialog>
  );
}
