import {
  Button,
  CopyButton,
  Field,
  IconButton,
  Input,
  Menu,
  Notice,
  PasswordInput,
  Select,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Link2, Lock, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { HolderPicker } from "../spaces/access/holders.js";
import type { SharedPage } from "./share-dialog.js";
import {
  linkAddress,
  pageAccessQuery,
  type ShareLink,
  type ShareLinkInput,
  type ShareLinkScope,
  type ShareLinks,
  shareLinksQuery,
  sharingKeys,
} from "./sharing-api.js";

const DAY = 24 * 60 * 60 * 1000;

interface Person {
  kind: "account" | "group";
  id: string;
  name: string;
}

export function scopeLabel(t: TFunction, scope: string, organizationName: string | null): string {
  if (scope === "organization" && organizationName) {
    return t("sharing.links.scopes.organizationOf", { organization: organizationName });
  }
  return translateKey(t, `sharing.links.scopes.${scope}`);
}

function dateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function endOfDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function expiryError(t: TFunction, value: string, required: boolean, maxDays: number): string | null {
  if (value === "") return required ? t("sharing.links.expiryRequired", { days: maxDays }) : null;
  const date = endOfDay(value);
  if (!date) return t("sharing.links.expiryInvalid");
  if (date.getTime() < Date.now()) return t("sharing.links.expiryPast");
  if (required && date.getTime() > Date.now() + maxDays * DAY) {
    return t("sharing.links.expiryTooLate", { days: maxDays });
  }
  return null;
}

function PeoplePicker({
  page,
  people,
  onChange,
  error,
}: {
  page: SharedPage;
  people: Person[];
  onChange: (people: Person[]) => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t("sharing.links.people")} hint={t("sharing.links.peopleHint")} error={error}>
      <div className="flex flex-col gap-2">
        <HolderPicker
          organizationId={page.organizationId}
          organizationName={page.organizationName}
          personal
          groups={!page.confidential}
          exclude={people.map((person) => `${person.kind}:${person.id}`)}
          value={null}
          onValueChange={(next) => {
            if (!next?.principalId) return;
            if (next.principalKind !== "account" && next.principalKind !== "group") return;
            onChange([...people, { kind: next.principalKind, id: next.principalId, name: next.name }]);
          }}
          label={t("sharing.links.people")}
          placeholder={t("sharing.people.addPlaceholder")}
          invalid={error !== null}
        />
        {people.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {people.map((person) => (
              <li
                key={`${person.kind}:${person.id}`}
                className="flex items-center gap-1 rounded-full border border-border ps-3"
              >
                <span className="max-w-60 truncate text-sm" title={person.name}>
                  {person.name}
                </span>
                <IconButton
                  label={t("sharing.links.removePerson", { name: person.name })}
                  icon={X}
                  onClick={() => onChange(people.filter((entry) => entry !== person))}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}

function CreateLink({
  page,
  options,
  restricted,
  onCreated,
  onCancel,
}: {
  page: SharedPage;
  options: ShareLinks["options"];
  restricted: boolean;
  onCreated: (link: { token: string; scope: ShareLinkScope }) => void;
  onCancel: (() => void) | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const peopleOnly = restricted || options.peopleOnly;
  const anyoneAllowed = options.anyone && !peopleOnly;
  const [scope, setScope] = useState<ShareLinkScope>(peopleOnly ? "people" : "organization");
  const [people, setPeople] = useState<Person[]>([]);
  const [expiry, setExpiry] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ people?: string; expiry?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const scopes: ShareLinkScope[] = peopleOnly
    ? ["people"]
    : ["people", "organization", "instance", ...(anyoneAllowed ? (["anyone"] as const) : [])];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (scope === "people" && people.length === 0) next.people = t("sharing.links.peopleRequired");
    const expiryProblem = expiryError(t, expiry, scope === "anyone", options.anyoneMaxDays);
    if (expiryProblem) next.expiry = expiryProblem;
    setErrors(next);
    if (next.people || next.expiry) {
      form.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    const body: ShareLinkInput = {
      scope,
      expiresAt: expiry ? (endOfDay(expiry)?.toISOString() ?? null) : null,
      ...(password ? { password } : {}),
      ...(scope === "people" ? { people: people.map(({ kind, id }) => ({ kind, id })) } : {}),
    };
    setBusy(true);
    try {
      const created = await request(() =>
        api.POST("/api/v1/pages/{pageId}/share-links", { params: { path: { pageId: page.id } }, body }),
      );
      await queryClient.invalidateQueries({ queryKey: sharingKeys.links(page.id) });
      onCreated({ token: created.token, scope });
    } catch (error) {
      setErrors({ form: problemMessage(t, error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      ref={form}
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-labelledby="share-link-create"
      className="flex flex-col gap-3 border-t border-border pt-4"
    >
      <h3 id="share-link-create" className="font-semibold">
        {t("sharing.links.createTitle")}
      </h3>
      <Field
        label={t("sharing.links.scope")}
        hint={[
          translateKey(t, `sharing.links.scopeHints.${scope}`),
          anyoneAllowed
            ? null
            : restricted
              ? t("sharing.links.restrictedOnlyPeople")
              : t("sharing.links.anyoneOff"),
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Select
          value={scope}
          onValueChange={(next) => setScope(next as ShareLinkScope)}
          options={scopes.map((value) => ({ value, label: scopeLabel(t, value, page.organizationName) }))}
        />
      </Field>
      {scope === "people" ? (
        <PeoplePicker page={page} people={people} onChange={setPeople} error={errors.people ?? null} />
      ) : null}
      <Field
        label={t("sharing.links.expiry")}
        hint={
          scope === "anyone"
            ? t("sharing.links.expiryHintAnyone", { days: options.anyoneMaxDays })
            : t("sharing.links.expiryHint")
        }
        error={errors.expiry ?? null}
        required={scope === "anyone"}
      >
        <Input
          type="date"
          value={expiry}
          className="w-auto"
          min={dateInput(new Date())}
          {...(scope === "anyone"
            ? { max: dateInput(new Date(Date.now() + options.anyoneMaxDays * DAY)) }
            : {})}
          invalid={Boolean(errors.expiry)}
          onChange={(event) => setExpiry(event.target.value)}
        />
      </Field>
      <Field label={t("sharing.links.password")} hint={t("sharing.links.passwordHint")}>
        <PasswordInput
          autoComplete="new-password"
          value={password}
          maxLength={200}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      {errors.form ? (
        <Notice variant="danger" title={t("sharing.links.createFailed")}>
          {errors.form}
        </Notice>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={busy}>
          {t("sharing.links.create")}
        </Button>
      </div>
    </form>
  );
}

function EditLink({ page, link, onDone }: { page: SharedPage; link: ShareLink; onDone: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = queryClient.getQueryData<ShareLinks>(sharingKeys.links(page.id))?.options;
  const maxDays = options?.anyoneMaxDays ?? 30;
  const [expiry, setExpiry] = useState(link.expiresAt ? dateInput(new Date(link.expiresAt)) : "");
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = expiryError(t, expiry, link.scope === "anyone", maxDays);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await request(() =>
        api.PATCH("/api/v1/pages/{pageId}/share-links/{linkId}", {
          params: { path: { pageId: page.id, linkId: link.id } },
          body: {
            expiresAt: expiry ? (endOfDay(expiry)?.toISOString() ?? null) : null,
            ...(removePassword ? { password: null } : password ? { password } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: sharingKeys.links(page.id) });
      toast({ title: t("sharing.links.changed"), variant: "success" });
      onDone();
    } catch (failed) {
      setFailure(problemMessage(t, failed));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3 pt-2">
      <Field label={t("sharing.links.expiry")} error={error} required={link.scope === "anyone"}>
        <Input
          type="date"
          value={expiry}
          min={dateInput(new Date())}
          invalid={error !== null}
          onChange={(event) => setExpiry(event.target.value)}
        />
      </Field>
      {link.hasPassword && !removePassword ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("sharing.links.hasPassword")}</span>
          <Button size="sm" variant="secondary" onClick={() => setRemovePassword(true)}>
            {t("sharing.links.removePassword")}
          </Button>
        </div>
      ) : null}
      {!removePassword ? (
        <Field
          label={link.hasPassword ? t("sharing.links.newPassword") : t("sharing.links.password")}
          hint={t("sharing.links.passwordHint")}
        >
          <PasswordInput
            autoComplete="new-password"
            value={password}
            maxLength={200}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      ) : (
        <p className="text-sm text-text-muted">{t("sharing.links.passwordRemoved")}</p>
      )}
      {failure ? (
        <Notice variant="danger" title={t("sharing.links.changeFailed")}>
          {failure}
        </Notice>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {t("sharing.links.save")}
        </Button>
      </div>
    </form>
  );
}

function LinkRow({ page, link }: { page: SharedPage; link: ShareLink }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"view" | "edit" | "revoke">("view");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const label = scopeLabel(t, link.scope, page.organizationName);
  const revoke = async () => {
    setBusy(true);
    try {
      await request(() =>
        api.DELETE("/api/v1/pages/{pageId}/share-links/{linkId}", {
          params: { path: { pageId: page.id, linkId: link.id } },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: sharingKeys.links(page.id) });
      await queryClient.invalidateQueries({ queryKey: sharingKeys.access(page.id) });
      toast({ title: t("sharing.links.revoked"), variant: "success" });
    } catch (error) {
      setFailure(problemMessage(t, error));
      setBusy(false);
    }
  };
  const meta = [
    link.expiresAt
      ? t("sharing.links.validUntil", { date: format.calendarDate(link.expiresAt) })
      : t("sharing.links.noExpiry"),
    t("sharing.links.opened", { count: link.visitors }),
  ];
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <Link2 aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate" title={label}>
            {label}
          </p>
          <p className="flex flex-wrap items-center gap-x-1 text-sm text-text-muted">
            <span>{meta.join(" · ")}</span>
            {link.hasPassword ? (
              <span className="inline-flex items-center gap-1">
                · <Lock aria-hidden="true" className="size-icon-sm" />
                {t("sharing.links.passwordBadge")}
              </span>
            ) : null}
          </p>
          {link.scope === "people" && link.people.length > 0 ? (
            <p className="truncate text-sm text-text-muted">
              {t("sharing.links.forPeople", {
                names: link.people
                  .map((person) => person.name ?? t("spaces.holders.unknownPerson"))
                  .join(", "),
              })}
            </p>
          ) : null}
        </div>
        {link.token ? (
          <CopyButton value={linkAddress(link.token)} label={t("sharing.links.copyShort")} />
        ) : null}
        <Menu
          trigger={
            <IconButton label={t("sharing.links.actions", { name: label })} icon={MoreHorizontal} size="sm" />
          }
          items={[
            {
              type: "header",
              title: label,
              description: t("sharing.links.createdBy", {
                name: link.createdBy?.name ?? t("files.someone"),
                date: format.date(link.createdAt),
              }),
            },
            { label: t("sharing.links.change"), icon: Pencil, onSelect: () => setMode("edit") },
            { type: "separator" },
            {
              label: t("sharing.links.revoke"),
              icon: Trash2,
              danger: true,
              onSelect: () => setMode("revoke"),
            },
          ]}
        />
      </div>
      {mode === "edit" ? <EditLink page={page} link={link} onDone={() => setMode("view")} /> : null}
      {mode === "revoke" ? (
        <Notice
          variant="warning"
          title={t("sharing.links.revokeTitle")}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setMode("view")}>
                {t("sharing.links.keep")}
              </Button>
              <Button size="sm" variant="danger" loading={busy} onClick={() => void revoke()}>
                {t("sharing.links.revokeConfirm")}
              </Button>
            </div>
          }
        >
          {t("sharing.links.revokeEffects", { count: link.visitors })}
          {failure ? <span className="mt-1 block text-danger">{failure}</span> : null}
        </Notice>
      ) : null}
    </li>
  );
}

export function ShareLinksPanel({ page }: { page: SharedPage }) {
  const { t } = useTranslation();
  const links = useQuery({ ...shareLinksQuery(page.id), throwOnError: false });
  const access = useQuery({ ...pageAccessQuery(page.id), throwOnError: false });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; scope: ShareLinkScope } | null>(null);
  if (links.isPending || access.isPending) return <Skeleton className="h-card w-full" />;
  if (links.isError) {
    return (
      <LoadError what={t("sharing.links.loadFailed")} error={links.error} onRetry={() => links.refetch()} />
    );
  }
  if (access.isError) {
    return <LoadError what={t("sharing.loadFailed")} error={access.error} onRetry={() => access.refetch()} />;
  }
  const { options } = links.data;
  const restricted = access.data.restrictions.view !== null || access.data.restrictions.inherited.length > 0;
  const list = links.data.links;
  const showForm = options.enabled && (creating || list.length === 0) && !created;
  return (
    <div className="flex flex-col gap-3">
      {!options.enabled ? (
        <Notice variant="info" title={t("sharing.links.disabledTitle")}>
          {t("sharing.links.disabled")}
        </Notice>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <p className="min-w-0 flex-1 text-sm text-text-muted">{t("sharing.links.intro")}</p>
          {!showForm && !created ? (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
              {t("sharing.links.new")}
            </Button>
          ) : null}
        </div>
      )}
      {created ? (
        <Notice
          variant="success"
          title={t("sharing.links.createdTitle")}
          action={
            <Button size="sm" variant="secondary" onClick={() => setCreated(null)}>
              {t("sharing.links.done")}
            </Button>
          }
        >
          <span className="flex flex-col gap-2">
            <span>
              {t("sharing.links.createdHint", { scope: scopeLabel(t, created.scope, page.organizationName) })}
            </span>
            <span className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-sm bg-surface-sunken px-2 py-1 text-sm">
                {linkAddress(created.token)}
              </code>
              <CopyButton value={linkAddress(created.token)} label={t("sharing.links.copy")} />
            </span>
          </span>
        </Notice>
      ) : null}
      {list.length > 0 ? (
        <section aria-labelledby="share-links-list">
          <h3 id="share-links-list" className="sr-only">
            {t("sharing.links.listTitle")}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {list.map((link) => (
              <LinkRow key={link.id} page={page} link={link} />
            ))}
          </ul>
        </section>
      ) : null}
      {showForm ? (
        <CreateLink
          page={page}
          options={options}
          restricted={restricted}
          onCreated={(link) => {
            setCreating(false);
            setCreated(link);
          }}
          onCancel={list.length > 0 ? () => setCreating(false) : null}
        />
      ) : null}
    </div>
  );
}
