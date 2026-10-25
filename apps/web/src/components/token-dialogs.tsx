import {
  type AccessLevel,
  type Areas,
  instanceAreas,
  organizationAreas,
  tokenNameSchema,
} from "@lunedo/shared";
import {
  Button,
  ConfirmDialog,
  classNames,
  Dialog,
  Field,
  IconButton,
  Input,
  Notice,
  Popover,
  RadioGroup,
  SegmentedControl,
  Select,
  useToast,
} from "@lunedo/ui";
import { Check, ChevronDown, ChevronRight, CircleHelp, Copy, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { ApiToken } from "../api/account-queries.js";
import { problemMessage } from "../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../forms/use-schema-form.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useInlineReauthentication } from "../session/reauthentication.js";
import { AppDatePicker } from "./date-fields.js";
import {
  type ContentAccess,
  ContentAccessFields,
  type ContentChoice,
  type ContentLevel,
  contentAccessOf,
  contentRequest,
  NO_CONTENT_ACCESS,
  useSpaceNames,
} from "./token-content-access.js";

const NONE = "none";
const EXPIRY_OPTIONS = ["never", "30", "90", "365", "custom"] as const;
const DAY_MS = 86_400_000;
const CONTENT_AREA = "spaces";
const ORGANIZATION_AREAS = organizationAreas.filter((area) => area !== CONTENT_AREA);

type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];
type Level = typeof NONE | AccessLevel;
type Preset = "read" | "write" | "admin" | "custom";
type Translate = Parameters<typeof translateKey>[0];

const PRESETS: Record<Exclude<Preset, "custom">, { content: ContentChoice; organization: Areas }> = {
  read: { content: "read", organization: {} },
  write: { content: "publish", organization: {} },
  admin: { content: "read", organization: { membersAndGroups: "manage", settings: "view" } },
};

export function defaultExpiry(maxLifetimeDays: number | null): ExpiryOption {
  const choices = expiryChoices(maxLifetimeDays);
  return choices.includes("90") ? "90" : (choices[0] ?? "custom");
}

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
});

type TokenFormValues = z.input<typeof tokenForm>;

export interface TokenRequest {
  name: string;
  scopes: { instance?: Areas; organization?: Areas };
  expiresAt: string | null;
  contentLevel?: ContentLevel;
  knowledgeBaseIds?: string[];
  limitedToOrganization: boolean;
}

interface Rights {
  content: ContentAccess;
  organization: Record<string, Level>;
  instance: Record<string, Level>;
  appliesTo: "organization" | "all";
}

function emptyLevels(areas: readonly string[], set: Areas = {}): Record<string, Level> {
  return Object.fromEntries(areas.map((area) => [area, (set as Record<string, Level>)[area] ?? NONE]));
}

function pickAreas(values: Record<string, Level>): Areas | undefined {
  const entries = Object.entries(values).filter(([, level]) => level !== NONE) as [string, AccessLevel][];
  return entries.length > 0 ? (Object.fromEntries(entries) as Areas) : undefined;
}

function presetOf(rights: Rights): Preset {
  const organization = pickAreas(rights.organization) ?? {};
  const instance = pickAreas(rights.instance);
  for (const [name, preset] of Object.entries(PRESETS) as [
    Exclude<Preset, "custom">,
    (typeof PRESETS)["read"],
  ][]) {
    if (
      !instance &&
      !rights.content.limited &&
      rights.content.choice === preset.content &&
      JSON.stringify(Object.entries(organization).sort()) ===
        JSON.stringify(Object.entries(preset.organization).sort())
    )
      return name;
  }
  return "custom";
}

function levelLabel(t: Translate, level: Level): string {
  return translateKey(t, `tokens.levels.${level}`).toLowerCase();
}

function rightsSummary(
  t: Translate,
  rights: Rights,
  options: { organization: boolean; instance: boolean; instanceLocked: boolean },
): { can: string[]; cannot: string[] } {
  const can: string[] = [];
  const cannot: string[] = [];
  if (options.organization) {
    if (rights.content.choice === NONE) cannot.push(t("tokens.summary.noContent"));
    else
      can.push(
        rights.content.limited
          ? t("tokens.summary.contentLimited", {
              level: translateKey(t, `tokens.content.levels.${rights.content.choice}`),
              count: rights.content.knowledgeBases.length,
            })
          : t("tokens.summary.contentAll", {
              level: translateKey(t, `tokens.content.levels.${rights.content.choice}`),
            }),
      );
    const missing: string[] = [];
    for (const area of ORGANIZATION_AREAS) {
      const level = rights.organization[area] ?? NONE;
      const label = translateKey(t, `areas.organization.${area}`);
      if (level === NONE) missing.push(label);
      else can.push(t("tokens.right", { area: label, level: levelLabel(t, level) }));
    }
    if (missing.length > 0) cannot.push(missing.join(", "));
  }
  if (options.instance) {
    const missing: string[] = [];
    for (const area of instanceAreas) {
      const level = options.instanceLocked ? NONE : (rights.instance[area] ?? NONE);
      const label = translateKey(t, `areas.instance.${area}`);
      if (level === NONE) missing.push(label);
      else can.push(t("tokens.summary.instanceRight", { area: label, level: levelLabel(t, level) }));
    }
    if (missing.length === instanceAreas.length) cannot.push(t("tokens.summary.noInstance"));
    else if (missing.length > 0)
      cannot.push(t("tokens.summary.instanceMissing", { areas: missing.join(", ") }));
  }
  return { can, cannot };
}

function Explanation({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover trigger={<IconButton label={label} icon={CircleHelp} size="sm" tooltip={false} />} align="start">
      <p className="max-w-field text-sm">{children}</p>
    </Popover>
  );
}

function MatrixRow({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
      <span className={classNames("min-w-0", muted && "text-text-muted")}>{label}</span>
      <div className="max-w-full">{children}</div>
    </div>
  );
}

function MatrixHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="border-t border-border pt-3 text-xs font-semibold tracking-label text-text-muted uppercase first:border-t-0 first:pt-0">
      {children}
    </h4>
  );
}

interface EditorProps {
  mode: "create" | "edit";
  rights: Rights;
  onRightsChange: (next: Rights) => void;
  allowInstance: boolean;
  allowOrganization: boolean;
  organizationId: string | null;
  organizationName: string | null;
  contentError: string | undefined;
  readOnlyContent: boolean;
}

function RightsEditor({
  mode,
  rights,
  onRightsChange,
  allowInstance,
  allowOrganization,
  organizationId,
  organizationName,
  contentError,
  readOnlyContent,
}: EditorProps) {
  const { t } = useTranslation();
  const detailsId = useId();
  const editing = mode === "edit";
  const [open, setOpen] = useState(editing || !allowOrganization);
  const choosesOrganizations = allowOrganization && organizationName !== null;
  const instanceLocked = choosesOrganizations && rights.appliesTo === "organization";
  const preset = presetOf(rights);
  const setCount =
    (rights.content.choice === NONE ? 0 : 1) +
    Object.values(rights.organization).filter((level) => level !== NONE).length +
    (instanceLocked ? 0 : Object.values(rights.instance).filter((level) => level !== NONE).length);
  const levelOptions = [
    { value: NONE, label: t("tokens.levels.none") },
    { value: "view", label: t("tokens.levels.view") },
    { value: "manage", label: t("tokens.levels.manage") },
  ];
  const applyPreset = (next: Preset) => {
    if (next === "custom") {
      setOpen(true);
      return;
    }
    const chosen = PRESETS[next];
    onRightsChange({
      ...rights,
      content: { ...rights.content, choice: chosen.content, limited: false },
      organization: emptyLevels(ORGANIZATION_AREAS, chosen.organization),
      instance: emptyLevels(instanceAreas),
    });
  };
  return (
    <div className="flex flex-col gap-5">
      {allowOrganization && !editing ? (
        <section aria-labelledby={`${detailsId}-purpose`} className="flex flex-col gap-2">
          <h3 id={`${detailsId}-purpose`} className="font-semibold">
            {t("tokens.purpose.title")}
          </h3>
          <p className="text-sm text-text-muted">{t("tokens.purpose.description")}</p>
          <RadioGroup
            label={t("tokens.purpose.title")}
            value={preset}
            onValueChange={(value) => applyPreset(value as Preset)}
            options={(["read", "write", "admin", "custom"] as const).map((value) => ({
              value,
              label: translateKey(t, `tokens.purpose.${value}`),
              aside: (
                <Explanation
                  label={t("tokens.purpose.explain", { name: translateKey(t, `tokens.purpose.${value}`) })}
                >
                  {translateKey(t, `tokens.purpose.descriptions.${value}`)}
                </Explanation>
              ),
            }))}
          />
        </section>
      ) : null}
      {choosesOrganizations ? (
        <section aria-labelledby={`${detailsId}-applies`} className="flex flex-col gap-2">
          <h3 id={`${detailsId}-applies`} className="font-semibold">
            {t("tokens.appliesTo")}
          </h3>
          {editing ? (
            <p>
              {rights.appliesTo === "organization"
                ? t("tokens.appliesToOrganization", { organization: organizationName })
                : t("tokens.appliesToAll")}
            </p>
          ) : (
            <>
              <SegmentedControl
                label={t("tokens.appliesTo")}
                value={rights.appliesTo}
                onValueChange={(value) =>
                  onRightsChange({ ...rights, appliesTo: value as Rights["appliesTo"] })
                }
                options={[
                  {
                    value: "organization",
                    label: t("tokens.appliesToOrganization", { organization: organizationName }),
                  },
                  { value: "all", label: t("tokens.appliesToAll") },
                ]}
              />
              {allowInstance ? <p className="text-sm text-text-muted">{t("tokens.appliesToHint")}</p> : null}
            </>
          )}
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h3>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${detailsId}-matrix`}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex items-center gap-1 rounded-sm font-semibold hover:underline focus-visible:focus-ring"
          >
            {open ? (
              <ChevronDown aria-hidden="true" className="size-icon-sm" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-icon-sm" />
            )}
            {t("tokens.details.title")}
            <span className="font-normal text-text-muted">
              {t("tokens.details.count", { count: setCount })}
            </span>
          </button>
        </h3>
        {open ? (
          <div id={`${detailsId}-matrix`} className="flex flex-col gap-2 rounded-md border border-border p-3">
            {editing ? <p className="text-sm text-text-muted">{t("tokens.details.onlyContent")}</p> : null}
            {allowOrganization ? (
              <>
                <MatrixHeading>{t("tokens.content.title")}</MatrixHeading>
                <ContentAccessFields
                  value={rights.content}
                  onChange={(content) => onRightsChange({ ...rights, content })}
                  organizationId={organizationId}
                  error={contentError}
                  allowNone={!editing}
                  readOnly={readOnlyContent}
                />
                <MatrixHeading>
                  {organizationName
                    ? t("tokens.details.organizationNamed", { organization: organizationName })
                    : t("tokens.organizationAccess")}
                </MatrixHeading>
                <p className="text-sm text-text-muted">{t("tokens.spacesUnderContent")}</p>
                <fieldset
                  aria-label={t("tokens.organizationAccess")}
                  className="flex flex-col divide-y divide-border"
                >
                  {ORGANIZATION_AREAS.map((area) => {
                    const label = translateKey(t, `areas.organization.${area}`);
                    return (
                      <MatrixRow key={area} label={label}>
                        <SegmentedControl
                          label={label}
                          value={rights.organization[area] ?? NONE}
                          disabled={editing}
                          onValueChange={(value) =>
                            onRightsChange({
                              ...rights,
                              organization: { ...rights.organization, [area]: value as Level },
                            })
                          }
                          options={levelOptions}
                        />
                      </MatrixRow>
                    );
                  })}
                </fieldset>
              </>
            ) : null}
            {allowInstance ? (
              <>
                <MatrixHeading>{t("tokens.instanceAccess")}</MatrixHeading>
                {instanceLocked ? (
                  <p className="text-sm text-text-muted">
                    {t("tokens.instanceNeedsAll", { organization: organizationName })}
                  </p>
                ) : null}
                <fieldset
                  aria-label={t("tokens.instanceAccess")}
                  className="flex flex-col divide-y divide-border"
                >
                  {instanceAreas.map((area) => {
                    const label = translateKey(t, `areas.instance.${area}`);
                    return (
                      <MatrixRow key={area} label={label} muted={instanceLocked}>
                        <SegmentedControl
                          label={label}
                          value={instanceLocked ? NONE : (rights.instance[area] ?? NONE)}
                          disabled={instanceLocked || editing}
                          onValueChange={(value) =>
                            onRightsChange({
                              ...rights,
                              instance: { ...rights.instance, [area]: value as Level },
                            })
                          }
                          options={levelOptions}
                        />
                      </MatrixRow>
                    );
                  })}
                </fieldset>
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Summary({
  rights,
  allowInstance,
  allowOrganization,
  instanceLocked,
  expiry,
  scope,
  children,
}: {
  rights: Rights;
  allowInstance: boolean;
  allowOrganization: boolean;
  instanceLocked: boolean;
  expiry: string;
  scope: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { can, cannot } = rightsSummary(t, rights, {
    organization: allowOrganization,
    instance: allowInstance,
    instanceLocked,
  });
  return (
    <aside
      aria-label={t("tokens.summary.title")}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-sunken p-4 md:sticky md:top-0 md:w-sidebar md:shrink-0 md:self-start"
    >
      <div aria-live="polite" className="flex flex-col gap-3">
        <div>
          <h3 className="text-xs font-semibold tracking-label text-text-muted uppercase">
            {t("tokens.summary.can")}
          </h3>
          {can.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {can.map((entry) => (
                <li key={entry} className="flex items-start gap-2">
                  <Check aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-success" />
                  <span className="min-w-0 wrap-anywhere">{entry}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-text-muted">{t("tokens.summary.nothing")}</p>
          )}
        </div>
        {cannot.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold tracking-label text-text-muted uppercase">
              {t("tokens.summary.cannot")}
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-text-muted">
              {cannot.map((entry) => (
                <li key={entry} className="flex items-start gap-2">
                  <X aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
                  <span className="min-w-0 wrap-anywhere">{entry}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="border-t border-border pt-3 text-sm text-text-muted">
          {[expiry, scope].filter(Boolean).join(" · ")}
        </p>
      </div>
      {children}
    </aside>
  );
}

function expiryText(
  t: Translate,
  format: ReturnType<typeof useFormat>,
  expiry: ExpiryOption,
  customDate: string,
): string {
  if (expiry === "never") return t("tokens.summary.neverExpires");
  if (expiry === "custom")
    return customDate
      ? t("tokens.summary.expiresOn", { date: format.calendarDate(`${customDate}T12:00:00`) })
      : t("tokens.summary.expiresCustom");
  return t("tokens.summary.expiresIn", { count: Number(expiry) });
}

function initialRights(): Rights {
  return {
    content: { ...NO_CONTENT_ACCESS, choice: PRESETS.read.content },
    organization: emptyLevels(ORGANIZATION_AREAS),
    instance: emptyLevels(instanceAreas),
    appliesTo: "organization",
  };
}

export function CreateTokenDialog({
  open,
  onOpenChange,
  allowInstance,
  allowOrganization,
  onCreate,
  hint,
  maxLifetimeDays,
  organizationId = null,
  organizationName = null,
}: {
  organizationId?: string | null;
  organizationName?: string | null;
  maxLifetimeDays: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowInstance: boolean;
  allowOrganization: boolean;
  onCreate: (request: TokenRequest) => Promise<{ token: string }>;
  hint?: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rights, setRights] = useState<Rights>(initialRights);
  const [contentError, setContentError] = useState<string | undefined>();
  const reauthentication = useInlineReauthentication(open && secret === null);
  const form = useSchemaForm(tokenForm, {
    defaultValues: {
      name: "",
      expiry: defaultExpiry(maxLifetimeDays),
      customDate: dateInDays(Math.min(30, maxLifetimeDays ?? 30)),
    } as TokenFormValues,
  });

  const choices = expiryChoices(maxLifetimeDays);
  const choosesOrganizations = allowOrganization && organizationName !== null;
  const instanceLocked = choosesOrganizations && rights.appliesTo === "organization";
  const latestDate = maxLifetimeDays === null ? undefined : dateInDays(maxLifetimeDays);
  const expiry = form.watch("expiry");
  const customDate = form.watch("customDate");

  useEffect(() => {
    const allowed = expiryChoices(maxLifetimeDays);
    if (!allowed.includes(form.getValues("expiry"))) form.setValue("expiry", defaultExpiry(maxLifetimeDays));
  }, [maxLifetimeDays, form]);

  const close = (next: boolean) => {
    if (!next) {
      setSecret(null);
      setError(null);
      setRights(initialRights());
      setContentError(undefined);
      form.reset();
    }
    onOpenChange(next);
  };

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    setContentError(undefined);
    const access = allowOrganization ? contentRequest(rights.content) : { spaces: null };
    const instance = allowInstance && !instanceLocked ? pickAreas(rights.instance) : undefined;
    const picked = allowOrganization ? pickAreas(rights.organization) : undefined;
    const organization =
      access.spaces === null ? picked : ({ ...(picked ?? {}), [CONTENT_AREA]: access.spaces } as Areas);
    if (access.knowledgeBaseIds && access.knowledgeBaseIds.length === 0) {
      setContentError(t("tokens.content.knowledgeBasesRequired"));
      return;
    }
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
        ...(access.contentLevel ? { contentLevel: access.contentLevel } : {}),
        ...(access.knowledgeBaseIds ? { knowledgeBaseIds: access.knowledgeBaseIds } : {}),
        limitedToOrganization: instanceLocked,
      });
      setSecret(created.token);
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={secret ? t("tokens.createdTitle") : t("tokens.createTitle")}
      description={secret ? undefined : (hint ?? t("tokens.neverMore"))}
      size={secret ? "md" : "xl"}
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
        <>
          {reauthentication.panel}
          <form
            className="flex flex-col gap-5 md:flex-row md:items-start"
            noValidate
            hidden={reauthentication.active}
            onSubmit={submitWith(submit)}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-5">
              {error ? (
                <Notice variant="danger" title={t("failures.createToken")}>
                  {error}
                </Notice>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("tokens.name")} error={form.formState.errors.name?.message}>
                  <Input
                    autoComplete="off"
                    autoFocus
                    placeholder={t("tokens.namePlaceholder")}
                    {...form.register("name")}
                  />
                </Field>
                <Field
                  label={t("tokens.expires")}
                  {...(maxLifetimeDays !== null
                    ? { hint: t("tokens.maximumApplies", { days: maxLifetimeDays }) }
                    : {})}
                >
                  <Controller
                    control={form.control}
                    name="expiry"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        options={choices.map((value) => ({
                          value,
                          label: translateKey(t, `tokens.expiry.${value}`),
                        }))}
                      />
                    )}
                  />
                </Field>
                {expiry === "custom" ? (
                  <div className="sm:col-start-2">
                    <Field label={t("tokens.customDate")} error={form.formState.errors.customDate?.message}>
                      <Controller
                        control={form.control}
                        name="customDate"
                        render={({ field }) => (
                          <AppDatePicker
                            value={field.value ?? ""}
                            min={dateInDays(1)}
                            {...(latestDate ? { max: latestDate } : {})}
                            invalid={Boolean(form.formState.errors.customDate)}
                            onValueChange={field.onChange}
                          />
                        )}
                      />
                    </Field>
                  </div>
                ) : null}
                {expiry === "never" ? (
                  <p className="flex items-start gap-2 text-sm text-warning sm:col-span-2">
                    <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
                    {t("tokens.noExpiryWarning")}
                  </p>
                ) : null}
              </div>
              <RightsEditor
                mode="create"
                rights={rights}
                onRightsChange={setRights}
                allowInstance={allowInstance}
                allowOrganization={allowOrganization}
                organizationId={organizationId}
                organizationName={organizationName}
                contentError={contentError}
                readOnlyContent={false}
              />
            </div>
            <Summary
              rights={rights}
              allowInstance={allowInstance}
              allowOrganization={allowOrganization}
              instanceLocked={instanceLocked}
              expiry={expiryText(t, format, expiry, customDate)}
              scope={
                choosesOrganizations
                  ? instanceLocked
                    ? t("tokens.appliesToOrganization", { organization: organizationName })
                    : t("tokens.appliesToAll")
                  : null
              }
            >
              <div className="flex flex-col gap-2">
                <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
                  {t("tokens.create")}
                </Button>
                <Button variant="secondary" onClick={() => close(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </Summary>
          </form>
        </>
      )}
    </Dialog>
  );
}

export function TokenRightsDialog({
  token,
  allowInstance,
  organizationName,
  onOpenChange,
  onSave,
}: {
  token: ApiToken | null;
  allowInstance: boolean;
  organizationName: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (change: { contentLevel: ContentLevel; knowledgeBaseIds: string[] | null }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [changed, setChanged] = useState<Rights | null>(null);
  const [contentError, setContentError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const names = useSpaceNames(token?.knowledgeBaseIds ?? []);
  const rights: Rights =
    changed ??
    (token
      ? {
          content: contentAccessOf(token, names),
          organization: emptyLevels(ORGANIZATION_AREAS, token.scopes.organization ?? {}),
          instance: emptyLevels(instanceAreas, token.scopes.instance ?? {}),
          appliesTo: token.organizationId ? "organization" : "all",
        }
      : initialRights());
  const instanceRights = allowInstance || Boolean(token?.scopes.instance);
  const close = (open: boolean) => {
    if (!open) {
      setChanged(null);
      setContentError(undefined);
      setError(null);
    }
    onOpenChange(open);
  };
  const save = async () => {
    setError(null);
    const content = rights.content;
    if (content.choice === NONE) return;
    if (content.limited && content.knowledgeBases.length === 0) {
      setContentError(t("tokens.content.knowledgeBasesRequired"));
      return;
    }
    setContentError(undefined);
    setSaving(true);
    try {
      await onSave({
        contentLevel: content.choice,
        knowledgeBaseIds: content.limited ? content.knowledgeBases.map((item) => item.value) : null,
      });
      close(false);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setSaving(false);
    }
  };
  const readOnlyContent = token?.scopes.organization?.spaces !== "manage";
  return (
    <Dialog
      open={token !== null}
      onOpenChange={close}
      title={t("tokens.rightsTitle", { name: token?.name ?? "" })}
      size="xl"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {error ? (
            <Notice variant="danger" title={t("tokens.content.changeFailed")}>
              {error}
            </Notice>
          ) : null}
          {readOnlyContent ? <Notice variant="info">{t("tokens.content.readOnlyScope")}</Notice> : null}
          <RightsEditor
            mode="edit"
            rights={rights}
            onRightsChange={setChanged}
            allowInstance={instanceRights}
            allowOrganization
            organizationId={token?.organizationId ?? null}
            organizationName={token?.organizationId ? organizationName : null}
            contentError={contentError}
            readOnlyContent={readOnlyContent}
          />
        </div>
        <Summary
          rights={rights}
          allowInstance={instanceRights}
          allowOrganization
          instanceLocked={false}
          expiry={
            token?.expiresAt
              ? t("tokens.summary.expiresOn", { date: format.calendarDate(token.expiresAt) })
              : t("tokens.summary.neverExpires")
          }
          scope={
            token?.organizationId && organizationName
              ? t("tokens.appliesToOrganization", { organization: organizationName })
              : null
          }
        >
          <div className="flex flex-col gap-2">
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {t("tokens.content.save")}
            </Button>
            <Button variant="secondary" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Summary>
      </div>
    </Dialog>
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
