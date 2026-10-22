import { accentColors } from "@lunedo/shared";
import {
  Button,
  ConfirmDialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  type SaveState,
  SaveStatus,
  Section,
  Select,
  SettingRow,
  Skeleton,
  Switch,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Palette } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { ApiError, request } from "../../api/request.js";
import { AutoSaveTextField } from "../../components/auto-save.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { useSpace } from "../../spaces/space-context.js";
import { knowledgeBaseKeys, type PortalSettings, portalQuery } from "../queries.js";

const CUSTOM = "custom";
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const LOGO_MAX_BYTES = 256 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

type Appearance = Partial<{
  brand: PortalSettings["brand"];
  confirmProposal: boolean;
  welcomeHeading: string;
  welcomeText: string;
  topBarThreshold: number;
  poweredBy: boolean;
  feedbackRetentionMonths: number;
}>;

interface BrandCheck {
  color: string;
  passes: boolean;
  proposal: string | null;
}

function useAppearance() {
  const { space } = useSpace();
  const queryClient = useQueryClient();
  return async (body: Appearance) => {
    const updated = await request(() =>
      api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/portal/appearance", {
        params: { path: { spaceId: space.id } },
        body,
      }),
    );
    queryClient.setQueryData(knowledgeBaseKeys.portal(space.id), updated);
    return updated;
  };
}

export function PortalAppearanceScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const portal = useQuery({ ...portalQuery(space.id), throwOnError: false });
  return (
    <SpaceSettingsPage
      tab="appearance"
      title={t("knowledgeBase.appearance.title")}
      description={t("knowledgeBase.appearance.description")}
      icon={Palette}
    >
      {portal.isPending ? <Skeleton className="h-field w-full" /> : null}
      {portal.isError ? (
        <LoadError
          what={t("knowledgeBase.appearance.loadFailed")}
          error={portal.error}
          onRetry={() => portal.refetch()}
        />
      ) : null}
      {portal.data ? <AppearanceForm portal={portal.data} /> : null}
    </SpaceSettingsPage>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className="size-icon-lg rounded-sm border border-border"
        style={{ background: color }}
      />
      <span className="font-mono">{label}</span>
    </span>
  );
}

function AppearanceForm({ portal }: { portal: PortalSettings }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const editable = space.role === "admin" && !space.archived;
  const save = useAppearance();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <a
          className="inline-flex items-center gap-1 text-sm text-accent underline"
          href={portal.url}
          target="_blank"
          rel="noopener"
        >
          <ExternalLink aria-hidden="true" className="size-icon-sm" />
          {t("knowledgeBase.appearance.open")}
        </a>
      </div>
      <Section title={t("knowledgeBase.appearance.identity")}>
        <LogoRow portal={portal} editable={editable} />
        <BrandRow portal={portal} editable={editable} />
      </Section>
      <Section title={t("knowledgeBase.appearance.startPage")}>
        <div className="flex flex-col gap-4 p-4">
          <AutoSaveTextField
            label={t("knowledgeBase.appearance.heading")}
            hint={t("knowledgeBase.appearance.headingHint")}
            value={portal.welcomeHeading}
            schema={z.string().max(120)}
            disabled={!editable}
            onSave={(welcomeHeading) => save({ welcomeHeading })}
          />
          <AutoSaveTextField
            label={t("knowledgeBase.appearance.text")}
            hint={t("knowledgeBase.appearance.textHint")}
            value={portal.welcomeText}
            schema={z.string().max(400)}
            multiline
            disabled={!editable}
            onSave={(welcomeText) => save({ welcomeText })}
          />
          <NumberSetting
            label={t("knowledgeBase.appearance.threshold")}
            hint={t("knowledgeBase.appearance.thresholdHint")}
            value={portal.topBarThreshold}
            min={1}
            max={100}
            disabled={!editable}
            onSave={(topBarThreshold) => save({ topBarThreshold })}
          />
          <p className="text-sm text-text-muted">
            {t("knowledgeBase.appearance.orderHint")}{" "}
            <Link
              to="/spaces/$spaceKey/settings/categories"
              params={{ spaceKey: space.key }}
              className="text-accent underline"
            >
              {t("knowledgeBase.appearance.orderLink")}
            </Link>
          </p>
        </div>
      </Section>
      <Section title={t("knowledgeBase.appearance.footer")}>
        <PoweredByRow portal={portal} editable={editable} />
      </Section>
      <Section title={t("knowledgeBase.appearance.feedback")}>
        <RetentionRow portal={portal} editable={editable} />
      </Section>
    </div>
  );
}

function useStatus() {
  const { t } = useTranslation();
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const last = useRef<(() => Promise<unknown>) | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    last.current = action;
    setState("saving");
    setError(null);
    try {
      await action();
      setState("saved");
      return true;
    } catch (failure) {
      setError(problemMessage(t, failure));
      setState("error");
      return false;
    }
  };
  const status = (
    <SaveStatus
      state={state}
      {...(error ? { error, onRetry: () => last.current && void run(last.current) } : {})}
    />
  );
  return { run, status };
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onSave,
  confirm,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onSave: (value: number) => Promise<unknown>;
  confirm?: (next: number, apply: () => void) => boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState<string | null>(null);
  const saver = useStatus();
  const commit = () => {
    const next = Number(draft);
    if (next === value) return;
    if (!Number.isInteger(next) || next < min || next > max) {
      setInvalid(t("knowledgeBase.appearance.numberInvalid", { min, max }));
      return;
    }
    setInvalid(null);
    const apply = () => void saver.run(() => onSave(next));
    if (confirm?.(next, apply)) return;
    apply();
  };
  return (
    <div className="flex flex-col gap-1">
      <Field label={label} hint={hint} {...(invalid ? { error: invalid } : {})}>
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          className="w-number-field"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      </Field>
      {saver.status}
    </div>
  );
}

function RetentionRow({ portal, editable }: { portal: PortalSettings; editable: boolean }) {
  const { t } = useTranslation();
  const save = useAppearance();
  const [pending, setPending] = useState<{ months: number; apply: () => void } | null>(null);
  return (
    <div className="flex flex-col gap-4 p-4">
      <NumberSetting
        label={t("knowledgeBase.appearance.retention")}
        hint={t("knowledgeBase.appearance.retentionHint")}
        value={portal.feedbackRetentionMonths}
        min={1}
        max={60}
        disabled={!editable}
        onSave={(feedbackRetentionMonths) => save({ feedbackRetentionMonths })}
        confirm={(months, apply) => {
          if (months >= portal.feedbackRetentionMonths) return false;
          setPending({ months, apply });
          return true;
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t("knowledgeBase.appearance.shortenTitle")}
        description={t("knowledgeBase.appearance.shortenDescription", { count: pending?.months ?? 0 })}
        confirmLabel={t("knowledgeBase.appearance.shortenConfirm", { count: pending?.months ?? 0 })}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          pending?.apply();
          setPending(null);
        }}
      />
    </div>
  );
}

function PoweredByRow({ portal, editable }: { portal: PortalSettings; editable: boolean }) {
  const { t } = useTranslation();
  const save = useAppearance();
  const saver = useStatus();
  return (
    <SettingRow
      label={t("knowledgeBase.appearance.poweredBy")}
      description={t("knowledgeBase.appearance.poweredByHint")}
      control={
        <Switch
          checked={portal.poweredBy}
          label={t("knowledgeBase.appearance.poweredBy")}
          labelHidden
          disabled={!editable}
          onCheckedChange={(poweredBy) => void saver.run(() => save({ poweredBy }))}
        />
      }
      status={saver.status}
    />
  );
}

export function BrandRow({ portal, editable }: { portal: PortalSettings; editable: boolean }) {
  const { t } = useTranslation();
  const save = useAppearance();
  const saver = useStatus();
  const [choice, setChoice] = useState<string>(portal.brand.color);
  const [light, setLight] = useState(portal.brand.light ?? portal.colors.light);
  const [dark, setDark] = useState(portal.brand.dark ?? portal.colors.dark);
  const [errors, setErrors] = useState<{ light?: string; dark?: string }>({});
  const [checks, setChecks] = useState<{ light: BrandCheck; dark: BrandCheck } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const choose = (value: string) => {
    setChoice(value);
    setChecks(null);
    if (value !== CUSTOM)
      void saver.run(() =>
        save({ brand: { color: value as PortalSettings["brand"]["color"], light: null, dark: null } }),
      );
  };

  const saveCustom = async (confirmProposal: boolean) => {
    const next: { light?: string; dark?: string } = {};
    if (!HEX.test(light.trim())) next.light = t("knowledgeBase.appearance.colorInvalid");
    if (!HEX.test(dark.trim())) next.dark = t("knowledgeBase.appearance.colorInvalid");
    setErrors(next);
    if (next.light || next.dark) {
      focusFirstInvalidSoon();
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const brand = { color: CUSTOM, light: light.trim(), dark: dark.trim() } as PortalSettings["brand"];
      const updated = await save({ brand, ...(confirmProposal ? { confirmProposal: true } : {}) });
      setLight(updated.colors.light);
      setDark(updated.colors.dark);
      setChecks(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === "brandContrast") {
        const problem = error.problem as unknown as { light: BrandCheck; dark: BrandCheck };
        setChecks({ light: problem.light, dark: problem.dark });
      } else {
        setFailure(problemMessage(t, error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Field label={t("knowledgeBase.appearance.color")} hint={t("knowledgeBase.appearance.colorHint")}>
        <Select
          value={choice}
          onValueChange={choose}
          disabled={!editable}
          options={[
            ...accentColors.map((color) => ({
              value: color,
              label: translateKey(t, `settings.values.accentColor.${color}`),
            })),
            { value: CUSTOM, label: t("knowledgeBase.appearance.customColor") },
          ]}
        />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Swatch
          color={portal.colors.light}
          label={t("knowledgeBase.appearance.lightValue", { value: portal.colors.light })}
        />
        <Swatch
          color={portal.colors.dark}
          label={t("knowledgeBase.appearance.darkValue", { value: portal.colors.dark })}
        />
      </div>
      {choice !== CUSTOM ? saver.status : null}
      {choice === CUSTOM && editable ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <Field
              label={t("knowledgeBase.appearance.light")}
              {...(errors.light ? { error: errors.light } : {})}
            >
              <Input
                value={light}
                className="w-unit-field font-mono"
                onChange={(event) => setLight(event.target.value)}
              />
            </Field>
            <Field
              label={t("knowledgeBase.appearance.dark")}
              {...(errors.dark ? { error: errors.dark } : {})}
            >
              <Input
                value={dark}
                className="w-unit-field font-mono"
                onChange={(event) => setDark(event.target.value)}
              />
            </Field>
          </div>
          {checks ? (
            <Notice variant="warning" title={t("knowledgeBase.appearance.contrastTitle")}>
              <p>{t("knowledgeBase.appearance.contrastText")}</p>
              <ul className="mt-2 flex flex-col gap-2">
                {(["light", "dark"] as const).map((mode) =>
                  checks[mode].passes ? null : (
                    <li key={mode} className="flex flex-wrap items-center gap-3">
                      <span>{t(`knowledgeBase.appearance.${mode}`)}:</span>
                      <Swatch color={checks[mode].color} label={checks[mode].color} />
                      {checks[mode].proposal ? (
                        <>
                          <span aria-hidden="true">→</span>
                          <Swatch color={checks[mode].proposal ?? ""} label={checks[mode].proposal ?? ""} />
                        </>
                      ) : (
                        <span>{t("knowledgeBase.appearance.noProposal")}</span>
                      )}
                    </li>
                  ),
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {checks.light.proposal && checks.dark.proposal ? (
                  <Button variant="primary" loading={saving} onClick={() => void saveCustom(true)}>
                    {t("knowledgeBase.appearance.useProposal")}
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => setChecks(null)}>
                  {t("knowledgeBase.appearance.otherColor")}
                </Button>
              </div>
            </Notice>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" loading={saving} onClick={() => void saveCustom(false)}>
                {t("knowledgeBase.appearance.checkAndSave")}
              </Button>
            </div>
          )}
          {failure ? <p className="text-sm text-danger">{failure}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function LogoRow({ portal, editable }: { portal: PortalSettings; editable: boolean }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);
  const upload = async (file: File) => {
    if (!(LOGO_TYPES as readonly string[]).includes(file.type) || file.size > LOGO_MAX_BYTES) {
      toast({
        title: t("knowledgeBase.appearance.logoFailed"),
        description: t("problems.invalidLogo"),
        variant: "error",
      });
      return;
    }
    const data = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())));
    try {
      const updated = await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/portal/logo", {
          params: { path: { spaceId: space.id } },
          body: { contentType: file.type as (typeof LOGO_TYPES)[number], data },
        }),
      );
      queryClient.setQueryData(knowledgeBaseKeys.portal(space.id), updated);
      toast({ title: t("knowledgeBase.appearance.logoUploaded"), variant: "success" });
    } catch (failure) {
      toast({
        title: t("knowledgeBase.appearance.logoFailed"),
        description: problemMessage(t, failure),
        variant: "error",
      });
    }
  };
  const remove = async () => {
    try {
      const updated = await request(() =>
        api.DELETE("/api/v1/spaces/{spaceId}/knowledge-base/portal/logo", {
          params: { path: { spaceId: space.id } },
        }),
      );
      queryClient.setQueryData(knowledgeBaseKeys.portal(space.id), updated);
    } catch (failure) {
      toast({
        title: t("knowledgeBase.appearance.logoRemoveFailed"),
        description: problemMessage(t, failure),
        variant: "error",
      });
    }
  };
  return (
    <SettingRow
      label={t("knowledgeBase.appearance.logo")}
      description={t("knowledgeBase.appearance.logoHint")}
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {portal.logoRef ? (
            <img
              src={`${portal.url}logo?v=${portal.logoRef}`}
              alt={t("knowledgeBase.appearance.logoAlt")}
              className="size-control-md rounded-md object-contain"
            />
          ) : (
            <span className="text-sm text-text-muted">{t("knowledgeBase.appearance.noLogo")}</span>
          )}
          {editable ? (
            <>
              <input
                ref={input}
                type="file"
                accept={LOGO_TYPES.join(",")}
                className="sr-only"
                aria-label={t("knowledgeBase.appearance.uploadLogo")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
                {portal.logoRef
                  ? t("knowledgeBase.appearance.replaceLogo")
                  : t("knowledgeBase.appearance.uploadLogo")}
              </Button>
              {portal.logoRef ? (
                <Button variant="outline" size="sm" onClick={() => setRemoving(true)}>
                  {t("common.removeLogo")}
                </Button>
              ) : null}
            </>
          ) : null}
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={t("knowledgeBase.appearance.removeLogoTitle")}
            description={t("knowledgeBase.appearance.removeLogoDescription")}
            confirmLabel={t("common.removeLogo")}
            cancelLabel={t("common.cancel")}
            onConfirm={async () => {
              await remove();
              setRemoving(false);
            }}
          />
        </div>
      }
    />
  );
}
