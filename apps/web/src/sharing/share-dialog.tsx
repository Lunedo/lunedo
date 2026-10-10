import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  IconButton,
  Input,
  Notice,
  Select,
  Skeleton,
  Tabs,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Lock, Mail, Trash2, UserPlus, Users } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { HolderPicker } from "../spaces/access/holders.js";
import { spaceKeys } from "../spaces/space-queries.js";
import { DisclosureButton } from "./disclosure.js";
import { ExplanationView } from "./explanation.js";
import { PendingChange } from "./page-impact.js";
import { ShareLinksPanel } from "./share-links.js";
import {
  type AccessChange,
  changeAccess,
  type PageAccess,
  type PageShare,
  pageAccessQuery,
  SHARE_ROLES,
  type ShareRole,
  sharingKeys,
} from "./sharing-api.js";

export interface SharedPage {
  id: string;
  title: string;
  spaceId: string;
  organizationId: string | null;
  organizationName: string | null;
  confidential?: boolean;
}

interface Pending {
  changes: AccessChange[];
  title: string;
  confirmLabel: string;
  destructive: boolean;
  done: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useShareRoleOptions() {
  const { t } = useTranslation();
  return SHARE_ROLES.map((role) => ({ value: role, label: t(`sharing.roles.${role}`) }));
}

function useScopeOptions() {
  const { t } = useTranslation();
  return [
    { value: "page", label: t("sharing.people.onlyThisPage") },
    { value: "descendants", label: t("sharing.people.withPagesBelow") },
  ];
}

function holderName(t: TFunction, share: PageShare): string {
  if (share.holder.kind === "group") {
    return share.holder.name ?? t("spaces.holders.unknownGroup");
  }
  return share.holder.name ?? t("spaces.holders.unknownPerson");
}

function ShareRow({ share, onChange }: { share: PageShare; onChange: (pending: Pending) => void }) {
  const { t } = useTranslation();
  const roleOptions = useShareRoleOptions();
  const scopeOptions = useScopeOptions();
  const name = holderName(t, share);
  const meta = [
    share.holder.kind === "group"
      ? t("sharing.people.groupMembers", { count: share.holder.members ?? 0 })
      : share.holder.email,
    share.spaceRole
      ? t("sharing.people.spaceRole", { role: t(`spaces.roles.${share.spaceRole}`) })
      : t("sharing.people.notInSpace"),
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {share.holder.kind === "group" ? (
          <Users aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
        ) : null}
        <div className="min-w-0">
          <p className="truncate font-medium" title={name}>
            {name}
            {share.holder.active ? null : (
              <span className="ms-2 inline-block">
                <Badge variant="warning">
                  {share.holder.kind === "group"
                    ? t("sharing.people.groupDeleted")
                    : t("sharing.people.inactive")}
                </Badge>
              </span>
            )}
          </p>
          <p className="truncate text-sm text-text-muted" title={meta.join(" · ")}>
            {meta.join(" · ")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select
          aria-label={t("sharing.people.roleOf", { name })}
          value={share.role}
          className="min-w-0 flex-1"
          options={roleOptions}
          onValueChange={(role) => {
            if (role === share.role) return;
            onChange({
              changes: [{ action: "changeShare", shareId: share.id, role: role as ShareRole }],
              title: t("sharing.people.changeRoleTitle", {
                name,
                role: t(`sharing.roles.${role as ShareRole}`),
              }),
              confirmLabel: t("sharing.people.changeRole"),
              destructive: false,
              done: t("sharing.people.changed", { name }),
            });
          }}
        />
        <Select
          aria-label={t("sharing.people.scopeOf", { name })}
          value={share.includeDescendants ? "descendants" : "page"}
          className="min-w-0 flex-1"
          options={scopeOptions}
          onValueChange={(scope) => {
            const includeDescendants = scope === "descendants";
            if (includeDescendants === share.includeDescendants) return;
            onChange({
              changes: [{ action: "changeShare", shareId: share.id, includeDescendants }],
              title: includeDescendants
                ? t("sharing.people.addBelowTitle", { name })
                : t("sharing.people.removeBelowTitle", { name }),
              confirmLabel: t("sharing.people.changeScope"),
              destructive: !includeDescendants,
              done: t("sharing.people.changed", { name }),
            });
          }}
        />
        <IconButton
          label={t("sharing.people.remove", { name })}
          icon={Trash2}
          onClick={() =>
            onChange({
              changes: [{ action: "removeShare", shareId: share.id }],
              title: t("sharing.people.removeTitle", { name }),
              confirmLabel: t("sharing.people.removeConfirm"),
              destructive: true,
              done: t("sharing.people.removed", { name }),
            })
          }
        />
      </div>
    </li>
  );
}

function AddPeople({
  page,
  access,
  onChange,
}: {
  page: SharedPage;
  access: PageAccess;
  onChange: (pending: Pending) => void;
}) {
  const { t } = useTranslation();
  const roleOptions = useShareRoleOptions();
  const [holder, setHolder] = useState<{
    principalKind: string;
    principalId: string | null;
    name: string;
  } | null>(null);
  const [role, setRole] = useState<ShareRole>("reader");
  const [below, setBelow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const exclude = access.shares.map((share) => `${share.holder.kind}:${share.holder.id}`);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!holder?.principalId || (holder.principalKind !== "account" && holder.principalKind !== "group")) {
      setError(t("sharing.people.chooseSomeone"));
      field.current?.querySelector<HTMLElement>("input, button")?.focus();
      return;
    }
    setError(null);
    onChange({
      changes: [
        {
          action: "share",
          holderKind: holder.principalKind,
          holderId: holder.principalId,
          role,
          includeDescendants: below,
        },
      ],
      title: t("sharing.people.shareTitle", { name: holder.name, role: t(`sharing.roles.${role}`) }),
      confirmLabel: t("sharing.people.shareConfirm"),
      destructive: false,
      done: t("sharing.people.shared", { name: holder.name }),
    });
    setHolder(null);
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div ref={field}>
        <Field label={t("sharing.people.addLabel")} hint={t("sharing.people.addHint")} error={error}>
          <HolderPicker
            organizationId={page.organizationId}
            organizationName={page.organizationName}
            personal
            groups={!page.confidential}
            exclude={exclude}
            value={holder?.principalId ? `${holder.principalKind}:${holder.principalId}` : null}
            onValueChange={(next) => {
              setHolder(next);
              if (next) setError(null);
            }}
            label={t("sharing.people.addLabel")}
            placeholder={t("sharing.people.addPlaceholder")}
            invalid={error !== null}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("sharing.people.role")}>
          <Select value={role} options={roleOptions} onValueChange={(next) => setRole(next as ShareRole)} />
        </Field>
        <Checkbox checked={below} onCheckedChange={setBelow} label={t("sharing.people.includeBelow")} />
        <Button type="submit" variant="primary" icon={UserPlus} className="ms-auto">
          {t("sharing.people.share")}
        </Button>
      </div>
      <p className="text-sm text-text-muted">{t("sharing.people.titleVisible", { title: page.title })}</p>
    </form>
  );
}

function InviteGuest({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const roleOptions = useShareRoleOptions();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("reader");
  const [below, setBelow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setError(t("sharing.guest.invalidEmail"));
      input.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await request(() =>
        api.POST("/api/v1/pages/{pageId}/access/invitations", {
          params: { path: { pageId } },
          body: { email: address, role, includeDescendants: below },
        }),
      );
      toast({ title: t("sharing.guest.sent", { email: address }), variant: "success" });
      setEmail("");
      setOpen(false);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <DisclosureButton open={open} onToggle={() => setOpen((value) => !value)} controls="share-guest">
        {t("sharing.guest.toggle")}
      </DisclosureButton>
      {open ? (
        <form
          id="share-guest"
          onSubmit={(event) => void submit(event)}
          noValidate
          className="flex flex-col gap-3 ps-4"
        >
          <Field label={t("sharing.guest.email")} hint={t("sharing.guest.hint")} error={error}>
            <Input
              ref={input}
              type="email"
              autoComplete="off"
              placeholder={t("sharing.guest.placeholder")}
              value={email}
              invalid={error !== null}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("sharing.people.role")}>
              <Select
                value={role}
                options={roleOptions}
                onValueChange={(next) => setRole(next as ShareRole)}
              />
            </Field>
            <Checkbox checked={below} onCheckedChange={setBelow} label={t("sharing.people.includeBelow")} />
            <Button type="submit" variant="secondary" icon={Mail} loading={busy} className="ms-auto">
              {t("sharing.guest.send")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Restrictions({ access, onChange }: { access: PageAccess; onChange: (pending: Pending) => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { view, edit, inherited, holders } = access.restrictions;
  const setBy = (info: NonNullable<typeof view>) =>
    t("sharing.restrict.setBy", {
      name: info.setBy?.name ?? t("files.someone"),
      date: format.date(info.setAt),
    });
  return (
    <section aria-labelledby="share-restrict" className="flex flex-col gap-3">
      <h3 id="share-restrict" className="flex items-center gap-2 font-semibold">
        <Lock aria-hidden="true" className="size-icon" />
        {t("sharing.restrict.title")}
      </h3>
      {inherited.length > 0 ? (
        <Notice variant="info" title={t("sharing.restrict.inheritedTitle")}>
          {t("sharing.restrict.inherited", {
            pages: inherited.map((page) => page.title ?? t("sharing.why.hiddenPage")).join(", "),
          })}
        </Notice>
      ) : null}
      <Field
        label={t("sharing.restrict.viewLabel")}
        hint={view ? setBy(view) : t("sharing.restrict.viewHint")}
      >
        <Select
          value={view ? "list" : "space"}
          options={[
            { value: "space", label: t("sharing.restrict.viewSpace") },
            { value: "list", label: t("sharing.restrict.viewList") },
          ]}
          onValueChange={(next) => {
            if ((next === "list") === (view !== null)) return;
            onChange(
              next === "list"
                ? {
                    changes: [{ action: "restrict", kind: "view" }],
                    title: t("sharing.restrict.viewRestrictTitle"),
                    confirmLabel: t("sharing.restrict.restrictConfirm"),
                    destructive: true,
                    done: t("sharing.restrict.restricted"),
                  }
                : {
                    changes: [{ action: "unrestrict", kind: "view" }],
                    title: t("sharing.restrict.viewOpenTitle"),
                    confirmLabel: t("sharing.restrict.openConfirm"),
                    destructive: false,
                    done: t("sharing.restrict.opened"),
                  },
            );
          }}
        />
      </Field>
      <Field
        label={t("sharing.restrict.editLabel")}
        hint={edit ? setBy(edit) : t("sharing.restrict.editHint")}
      >
        <Select
          value={edit ? "list" : "space"}
          options={[
            { value: "space", label: t("sharing.restrict.editSpace") },
            { value: "list", label: t("sharing.restrict.editList") },
          ]}
          onValueChange={(next) => {
            if ((next === "list") === (edit !== null)) return;
            onChange(
              next === "list"
                ? {
                    changes: [{ action: "restrict", kind: "edit" }],
                    title: t("sharing.restrict.editRestrictTitle"),
                    confirmLabel: t("sharing.restrict.restrictConfirm"),
                    destructive: true,
                    done: t("sharing.restrict.restricted"),
                  }
                : {
                    changes: [{ action: "unrestrict", kind: "edit" }],
                    title: t("sharing.restrict.editOpenTitle"),
                    confirmLabel: t("sharing.restrict.openConfirm"),
                    destructive: false,
                    done: t("sharing.restrict.opened"),
                  },
            );
          }}
        />
      </Field>
      {holders.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className="font-medium">{t("sharing.restrict.holdersTitle")}</h4>
          <p className="text-sm text-text-muted">{t("sharing.restrict.holdersHint")}</p>
          <ul className="flex flex-col gap-1">
            {holders.map((entry) => (
              <li
                key={`${entry.kind}:${entry.holder.kind}:${entry.holder.id}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3"
              >
                <span className="min-w-0 break-words">
                  {entry.holder.name ??
                    t(
                      entry.holder.kind === "group"
                        ? "spaces.holders.unknownGroup"
                        : "spaces.holders.unknownPerson",
                    )}
                </span>
                <span className="text-sm text-text-muted">
                  {entry.kind === "view"
                    ? t("sharing.restrict.holderView")
                    : t("sharing.restrict.holderEdit")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CheckAccess({ page }: { page: SharedPage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const explanation = useQuery({
    queryKey: ["items", page.id, "explain", person],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/pages/{pageId}/access/explain", {
          params: { path: { pageId: page.id }, query: { accountId: person ?? "" } },
        }),
      ),
    enabled: person !== null,
    throwOnError: false,
  });
  return (
    <section className="flex flex-col gap-2">
      <DisclosureButton open={open} onToggle={() => setOpen((value) => !value)} controls="share-why">
        {t("sharing.why.toggle")}
      </DisclosureButton>
      {open ? (
        <div id="share-why" className="flex flex-col gap-3 ps-4">
          <Field label={t("sharing.why.person")}>
            <HolderPicker
              organizationId={page.organizationId}
              organizationName={page.organizationName}
              personal
              groups={false}
              exclude={[]}
              value={person ? `account:${person}` : null}
              onValueChange={(next) => setPerson(next?.principalId ?? null)}
              label={t("sharing.why.person")}
              placeholder={t("sharing.why.placeholder")}
            />
          </Field>
          {person && explanation.isPending ? <Skeleton className="h-12 w-full" /> : null}
          {explanation.isError ? (
            <LoadError
              what={t("sharing.why.loadFailed")}
              error={explanation.error}
              onRetry={() => explanation.refetch()}
            />
          ) : null}
          {explanation.data ? <ExplanationView explanation={explanation.data} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function PeopleAndAccess({ page }: { page: SharedPage }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const access = useQuery({ ...pageAccessQuery(page.id), throwOnError: false });
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const top = useRef<HTMLDivElement>(null);

  const propose = (next: Pending) => {
    setFailure(null);
    setPending(next);
    requestAnimationFrame(() => top.current?.scrollIntoView({ block: "nearest" }));
  };

  const apply = async (change: Pending) => {
    try {
      const updated = await changeAccess(page.id, change.changes);
      queryClient.setQueryData(sharingKeys.access(page.id), updated);
      setPending(null);
      toast({ title: change.done, variant: "success" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: spaceKeys.item(page.id) }),
        queryClient.invalidateQueries({ queryKey: ["spaces", page.spaceId, "children"] }),
        queryClient.invalidateQueries({ queryKey: sharingKeys.links(page.id) }),
        queryClient.invalidateQueries({ queryKey: sharingKeys.mine(page.id) }),
      ]);
    } catch (error) {
      setFailure(error);
    }
  };

  if (access.isPending) return <Skeleton className="h-card w-full" />;
  if (access.isError) {
    return <LoadError what={t("sharing.loadFailed")} error={access.error} onRetry={() => access.refetch()} />;
  }
  const data = access.data;
  return (
    <div className="flex flex-col gap-5">
      <div ref={top} className="flex flex-col gap-3">
        {pending ? (
          <>
            <PendingChange
              key={JSON.stringify(pending.changes)}
              pageId={page.id}
              changes={pending.changes}
              title={pending.title}
              confirmLabel={pending.confirmLabel}
              destructive={pending.destructive}
              onConfirm={() => apply(pending)}
              onCancel={() => {
                setPending(null);
                setFailure(null);
              }}
            />
            {failure ? (
              <Notice variant="danger" title={t("sharing.changeFailed")}>
                {problemMessage(t, failure)}
              </Notice>
            ) : null}
          </>
        ) : (
          <AddPeople page={page} access={data} onChange={propose} />
        )}
      </div>
      {data.canInviteGuests && !pending ? <InviteGuest pageId={page.id} /> : null}
      <section aria-labelledby="share-list" className="flex flex-col">
        <h3 id="share-list" className="font-semibold">
          {t("sharing.people.listTitle")}
        </h3>
        <p className="text-sm text-text-muted">{t("sharing.people.listHint")}</p>
        {data.shares.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">{t("sharing.people.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.shares.map((share) => (
              <ShareRow key={share.id} share={share} onChange={propose} />
            ))}
          </ul>
        )}
      </section>
      {data.linkVisitors.length > 0 ? (
        <section aria-labelledby="share-visitors" className="flex flex-col gap-1">
          <h3 id="share-visitors" className="font-semibold">
            {t("sharing.people.viaLinkTitle")}
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {data.linkVisitors.map((visitor) => (
              <li
                key={`${visitor.linkId}-${visitor.accountId}`}
                className="flex flex-wrap items-center gap-2 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {visitor.name ?? t("spaces.holders.unknownPerson")}
                </span>
                <Badge>{t("sharing.people.viaLink")}</Badge>
                <span className="text-sm text-text-muted">
                  {t("sharing.people.lastOpened", { date: format.dateTime(visitor.lastOpenedAt) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Restrictions access={data} onChange={propose} />
      <CheckAccess page={page} />
    </div>
  );
}

export function ShareDialog({
  page,
  open,
  onOpenChange,
}: {
  page: SharedPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("people");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("sharing.dialogTitle", { title: page.title })}
      description={t("sharing.dialogDescription")}
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        label={t("sharing.tabs.label")}
        tabs={[
          { value: "people", label: t("sharing.tabs.people") },
          { value: "links", label: t("sharing.tabs.links") },
        ]}
      >
        {tab === "people" ? <PeopleAndAccess page={page} /> : <ShareLinksPanel page={page} />}
      </Tabs>
    </Dialog>
  );
}
