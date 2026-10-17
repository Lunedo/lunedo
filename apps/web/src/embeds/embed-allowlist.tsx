import {
  DEFAULT_EMBED_REFERRER_POLICY,
  defaultEmbedServices,
  EMBED_ID_PATTERN,
  EMBED_REFERRER_POLICIES,
  type EmbedReferrerPolicy,
  type EmbedService,
  embedRuleProblem,
  MAX_EMBED_SERVICES,
} from "@pagehall/editor-schema";
import {
  Button,
  Checkbox,
  Field,
  focusFirstInvalidSoon,
  Input,
  List,
  ListRow,
  Select,
  useToast,
} from "@pagehall/ui";
import { Globe, Plus, RotateCcw, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SaveIndicator, useSaveState } from "../components/auto-save.js";

export function hostsOf(service: EmbedService): string {
  const hosts = new Set<string>();
  for (const rule of service.rules) {
    const match = /^https:\/\/([^/?#]+)/.exec(rule.pattern);
    if (match?.[1]) hosts.add(match[1].replace(/\{[^}]+\}/g, "*"));
  }
  return [...hosts].join(", ");
}

export function sendsOrigin(service: EmbedService): boolean {
  return service.rules.some(
    (rule) => (rule.referrerPolicy ?? DEFAULT_EMBED_REFERRER_POLICY) !== "no-referrer",
  );
}

function serviceId(name: string, taken: readonly EmbedService[]): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 30) || "service";
  let id = base;
  for (let number = 2; taken.some((service) => service.id === id); number += 1) id = `${base}-${number}`;
  return EMBED_ID_PATTERN.test(id) ? id : `service-${taken.length + 1}`;
}

function AddServiceForm({
  services,
  onAdd,
}: {
  services: readonly EmbedService[];
  onAdd: (service: EmbedService) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [embed, setEmbed] = useState("");
  const [referrerPolicy, setReferrerPolicy] = useState<EmbedReferrerPolicy>(DEFAULT_EMBED_REFERRER_POLICY);
  const [errors, setErrors] = useState<{ name?: string; pattern?: string }>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const rule = { pattern: pattern.trim(), embed: embed.trim() || pattern.trim(), referrerPolicy };
    const next: { name?: string; pattern?: string } = {};
    if (name.trim().length === 0) next.name = t("embeds.allowlist.nameRequired");
    const problem = rule.pattern.length === 0 ? "missing" : embedRuleProblem(rule);
    if (problem) next.pattern = t("embeds.allowlist.patternInvalid");
    if (services.length >= MAX_EMBED_SERVICES)
      next.name = t("embeds.allowlist.tooMany", { count: MAX_EMBED_SERVICES });
    setErrors(next);
    if (next.name || next.pattern) {
      focusFirstInvalidSoon(form.current ?? undefined);
      return;
    }
    const added = await onAdd({
      id: serviceId(name, services),
      name: name.trim().slice(0, 100),
      rules: [rule],
    });
    if (added) {
      setName("");
      setPattern("");
      setEmbed("");
      setReferrerPolicy(DEFAULT_EMBED_REFERRER_POLICY);
    }
  };

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 sm:grid-cols-2"
    >
      <Field label={t("embeds.allowlist.name")} error={errors.name}>
        <Input
          value={name}
          maxLength={100}
          invalid={!!errors.name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        label={t("embeds.allowlist.pattern")}
        hint={t("embeds.allowlist.patternHint")}
        error={errors.pattern}
      >
        <Input
          value={pattern}
          inputMode="url"
          className="font-mono"
          placeholder={t("embeds.allowlist.patternPlaceholder")}
          invalid={!!errors.pattern}
          onChange={(event) => setPattern(event.target.value)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label={t("embeds.allowlist.embed")} hint={t("embeds.allowlist.embedHint")}>
          <Input
            value={embed}
            inputMode="url"
            className="font-mono"
            placeholder={t("embeds.allowlist.embedPlaceholder")}
            onChange={(event) => setEmbed(event.target.value)}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={t("embeds.allowlist.referrer")} hint={t("embeds.allowlist.referrerHint")}>
          <Select
            value={referrerPolicy}
            onValueChange={(value) => setReferrerPolicy(value as EmbedReferrerPolicy)}
            options={EMBED_REFERRER_POLICIES.map((policy) => ({
              value: policy,
              label: t(`embeds.allowlist.referrerPolicy.${policy}`),
            }))}
          />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" icon={Plus}>
          {t("embeds.allowlist.add")}
        </Button>
      </div>
    </form>
  );
}

export function InstanceEmbedAllowlist({
  services,
  canManage,
  onSave,
}: {
  services: readonly EmbedService[];
  canManage: boolean;
  onSave: (services: EmbedService[]) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const tracker = useSaveState();
  const [restore, setRestore] = useState("");
  const missing = defaultEmbedServices.filter(
    (service) => !services.some((entry) => entry.id === service.id),
  );

  const save = (next: EmbedService[]) => tracker.run(() => onSave(next));

  const remove = async (service: EmbedService) => {
    const before = [...services];
    if (!(await save(services.filter((entry) => entry.id !== service.id)))) return;
    toast({
      variant: "success",
      title: t("embeds.allowlist.removed", { name: service.name }),
      undo: { onUndo: () => void save(before), seconds: 10 },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-text-muted">{t("embeds.allowlist.instanceDescription")}</p>
        <SaveIndicator tracker={tracker} />
      </div>
      {services.length === 0 ? (
        <p className="text-sm text-text-muted">{t("embeds.allowlist.empty")}</p>
      ) : (
        <List label={t("embeds.allowlist.title")}>
          {services.map((service) => (
            <ListRow
              key={service.id}
              icon={Globe}
              title={service.name}
              description={
                <span className="flex flex-col">
                  <span className="font-mono wrap-anywhere">{hostsOf(service)}</span>
                  {sendsOrigin(service) ? <span>{t("embeds.allowlist.sendsOrigin")}</span> : null}
                </span>
              }
              actions={
                canManage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={X}
                    aria-label={t("embeds.allowlist.removeNamed", { name: service.name })}
                    onClick={() => void remove(service)}
                  >
                    {t("embeds.allowlist.remove")}
                  </Button>
                ) : null
              }
            />
          ))}
        </List>
      )}
      {canManage ? (
        <>
          {missing.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={t("embeds.allowlist.restore")}>
                  <Select
                    value={restore}
                    onValueChange={setRestore}
                    placeholder={t("embeds.allowlist.restorePlaceholder")}
                    options={missing.map((service) => ({ value: service.id, label: service.name }))}
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                icon={RotateCcw}
                onClick={() => {
                  const service = missing.find((entry) => entry.id === restore);
                  if (!service) return;
                  setRestore("");
                  void save([...services, service]);
                }}
              >
                {t("embeds.allowlist.restoreAction")}
              </Button>
            </div>
          ) : null}
          <AddServiceForm services={services} onAdd={(service) => save([...services, service])} />
        </>
      ) : null}
    </div>
  );
}

export function OrganizationEmbedAllowlist({
  available,
  allowed,
  canManage,
  onSave,
}: {
  available: readonly EmbedService[];
  allowed: readonly string[] | null;
  canManage: boolean;
  onSave: (allowed: string[] | null) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const tracker = useSaveState();
  const chosen = allowed ?? available.map((service) => service.id);
  const toggle = (id: string, on: boolean) => {
    const next = available
      .map((service) => service.id)
      .filter((entry) => (entry === id ? on : chosen.includes(entry)));
    void tracker.run(() => onSave(next));
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">
          {allowed === null ? t("embeds.allowlist.inherited") : t("embeds.allowlist.narrowed")}
        </p>
        <span className="flex items-center gap-2">
          <SaveIndicator tracker={tracker} />
          {allowed !== null && canManage ? (
            <Button
              size="sm"
              variant="outline"
              icon={RotateCcw}
              onClick={() => void tracker.run(() => onSave(null))}
            >
              {t("embeds.allowlist.reset")}
            </Button>
          ) : null}
        </span>
      </div>
      {available.length === 0 ? (
        <p className="text-sm text-text-muted">{t("embeds.allowlist.instanceEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {available.map((service) => (
            <li key={service.id} className="flex flex-col gap-1">
              {canManage ? (
                <Checkbox
                  checked={chosen.includes(service.id)}
                  onCheckedChange={(on) => toggle(service.id, on)}
                  label={service.name}
                />
              ) : (
                <span className="font-medium">
                  {service.name}
                  <span className="ml-2 text-sm text-text-muted">
                    {chosen.includes(service.id)
                      ? t("embeds.allowlist.isAllowed")
                      : t("embeds.allowlist.isBlocked")}
                  </span>
                </span>
              )}
              <span className="pl-8 font-mono text-sm text-text-muted wrap-anywhere">{hostsOf(service)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
