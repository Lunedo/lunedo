import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Inbox, KeyRound, Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { useSession } from "../shell/shell-context.js";
import { itemSlug } from "../spaces/item-paths.js";
import { sharedPath } from "../spaces/space-queries.js";
import { accessRoleLabel } from "./explanation.js";
import type { AccessRequest } from "./sharing-api.js";
import { sharingKeys } from "./sharing-api.js";

const MESSAGE_LIMIT = 1000;
const SPACE_ROLES = ["reader", "commenter", "editor", "admin"] as const;
const PAGE_ROLES = ["reader", "commenter", "editor"] as const;

export function requestTarget(t: TFunction, entry: AccessRequest): string {
  if (entry.itemId) {
    return entry.itemTitle
      ? t("sharing.requests.targetPage", { title: entry.itemTitle })
      : t("sharing.requests.targetHiddenPage");
  }
  return t("sharing.requests.targetSpace", { name: entry.spaceName || t("sharing.requests.hiddenSpace") });
}

function statusLabel(t: TFunction, status: string): string {
  return translateKey(t, `sharing.requests.status.${status}`);
}

export function RequestAccessForm({
  target,
  onSent,
}: {
  target: { type: "page"; id: string } | { type: "space"; id: string; name: string };
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (message.length > MESSAGE_LIMIT) {
      setError(t("sharing.requests.messageTooLong", { limit: MESSAGE_LIMIT }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (target.type === "page") {
        await request(() =>
          api.POST("/api/v1/pages/{pageId}/access-requests", {
            params: { path: { pageId: target.id } },
            body: { message },
          }),
        );
      } else {
        await request(() =>
          api.POST("/api/v1/spaces/{spaceId}/access-requests", {
            params: { path: { spaceId: target.id } },
            body: { message },
          }),
        );
      }
      setSent(true);
      await queryClient.invalidateQueries({ queryKey: sharingKeys.myRequests });
      onSent?.();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <Notice variant="success" title={t("sharing.requests.sentTitle")}>
        {t("sharing.requests.sent")}{" "}
        <Link to="/access-requests" className="text-accent underline focus-visible:focus-ring">
          {t("sharing.requests.mineLink")}
        </Link>
      </Notice>
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
      <Field
        label={t("sharing.requests.message")}
        hint={t("sharing.requests.messageHint", { limit: MESSAGE_LIMIT })}
        error={error}
      >
        <Textarea
          value={message}
          rows={3}
          invalid={error !== null}
          onChange={(event) => setMessage(event.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" icon={Send} loading={busy} className="self-start">
        {target.type === "page"
          ? t("sharing.requests.requestPage")
          : t("sharing.requests.requestSpace", { name: target.name })}
      </Button>
    </form>
  );
}

export function NoPageAccess({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 pt-6 md:px-8">
      <EmptyState
        icon={KeyRound}
        title={t("sharing.requests.noAccessTitle")}
        description={t("sharing.requests.noAccess")}
      />
      <RequestAccessForm target={{ type: "page", id: pageId }} />
    </div>
  );
}

function Decision({ entry, onDecided }: { entry: AccessRequest; onDecided: (next: AccessRequest) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = entry.itemId ? PAGE_ROLES : SPACE_ROLES;
  const [role, setRole] = useState<(typeof SPACE_ROLES)[number]>("reader");
  const [below, setBelow] = useState(false);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const name = entry.requester.name ?? t("spaces.holders.unknownPerson");
  const decide = async (approve: boolean) => {
    setBusy(approve ? "approve" : "decline");
    setFailure(null);
    try {
      const next = await request(() =>
        api.POST("/api/v1/access-requests/{requestId}/decide", {
          params: { path: { requestId: entry.id } },
          body: approve ? { approve: true, role, includeDescendants: below } : { approve: false },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: sharingKeys.requests(entry.spaceId) });
      toast({
        title: approve ? t("sharing.requests.approved", { name }) : t("sharing.requests.declined", { name }),
        variant: "success",
      });
      onDecided(next);
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("sharing.requests.role")}>
          <Select
            value={role}
            options={roles.map((value) => ({ value, label: accessRoleLabel(t, value) }))}
            onValueChange={(next) => setRole(next as (typeof SPACE_ROLES)[number])}
          />
        </Field>
        {entry.itemId ? (
          <Checkbox checked={below} onCheckedChange={setBelow} label={t("sharing.people.includeBelow")} />
        ) : null}
      </div>
      {failure ? (
        <Notice variant="danger" title={t("sharing.requests.decideFailed")}>
          {failure}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy === "approve"} onClick={() => void decide(true)}>
          {t("sharing.requests.approve", { name, role: accessRoleLabel(t, role) })}
        </Button>
        <Button variant="secondary" loading={busy === "decline"} onClick={() => void decide(false)}>
          {t("sharing.requests.decline")}
        </Button>
      </div>
    </div>
  );
}

export function AccessRequestCard({
  entry,
  canDecide,
  onChanged,
}: {
  entry: AccessRequest;
  canDecide: boolean;
  onChanged?: (next: AccessRequest) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const name = entry.requester.name ?? t("spaces.holders.unknownPerson");
  return (
    <article className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 font-semibold">
          {t("sharing.requests.summary", { name, target: requestTarget(t, entry) })}
        </h3>
        <Badge variant={entry.status === "open" ? "warning" : "neutral"}>
          {statusLabel(t, entry.status)}
        </Badge>
      </div>
      <p className="text-sm text-text-muted">
        {[entry.requester.email, t("sharing.requests.sentOn", { date: format.dateTime(entry.createdAt) })]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {entry.message ? (
        <blockquote className="border-s-2 border-border ps-3 whitespace-pre-wrap">{entry.message}</blockquote>
      ) : null}
      {entry.status !== "open" && entry.decidedAt ? (
        <p className="text-sm">
          {t("sharing.requests.decidedBy", {
            name: entry.decidedBy?.name ?? t("files.someone"),
            date: format.dateTime(entry.decidedAt),
          })}
          {entry.role ? ` · ${accessRoleLabel(t, entry.role)}` : ""}
        </p>
      ) : null}
      {canDecide && entry.status === "open" ? (
        <Decision entry={entry} onDecided={(next) => onChanged?.(next)} />
      ) : null}
    </article>
  );
}

function MyRequestRow({ entry }: { entry: AccessRequest }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const withdraw = async () => {
    setBusy(true);
    try {
      await request(() =>
        api.POST("/api/v1/access-requests/{requestId}/withdraw", {
          params: { path: { requestId: entry.id } },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: sharingKeys.myRequests });
      toast({ title: t("sharing.requests.withdrawn"), variant: "success" });
    } catch (error) {
      toast({
        title: t("sharing.requests.withdrawFailed"),
        description: problemMessage(t, error),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  const target =
    entry.itemId && entry.itemTitle && entry.status === "approved"
      ? sharedPath(entry.itemId, itemSlug(entry.itemTitle))
      : null;
  return (
    <li className="flex flex-wrap items-center gap-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{requestTarget(t, entry)}</p>
        <p className="text-sm text-text-muted">
          {t("sharing.requests.sentOn", { date: format.dateTime(entry.createdAt) })}
        </p>
      </div>
      <Badge variant={entry.status === "open" ? "warning" : "neutral"}>{statusLabel(t, entry.status)}</Badge>
      {target ? (
        <Link to={target} className="min-h-hit px-2 text-accent underline focus-visible:focus-ring">
          {t("sharing.requests.open")}
        </Link>
      ) : null}
      {entry.status === "open" ? (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void withdraw()}>
          {t("sharing.requests.withdraw")}
        </Button>
      ) : null}
    </li>
  );
}

export function MyAccessRequestsScreen() {
  const { t } = useTranslation();
  useDocumentTitle(t("sharing.requests.mineTitle"));
  const mine = useQuery({
    queryKey: sharingKeys.myRequests,
    queryFn: () => request(() => api.GET("/api/v1/access-requests/mine")),
    throwOnError: false,
  });
  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader
          title={t("sharing.requests.mineTitle")}
          description={t("sharing.requests.mineDescription")}
          icon={Inbox}
        />
        {mine.isPending ? <Skeleton className="h-card w-full" /> : null}
        {mine.isError ? (
          <LoadError
            what={t("sharing.requests.loadFailed")}
            error={mine.error}
            onRetry={() => mine.refetch()}
          />
        ) : null}
        {mine.data?.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t("sharing.requests.mineEmptyTitle")}
            description={t("sharing.requests.mineEmpty")}
          />
        ) : null}
        {mine.data && mine.data.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {mine.data.map((entry) => (
              <MyRequestRow key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}

const requestRoute = getRouteApi("/app/access-requests/$requestId");

export function AccessRequestScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const { requestId } = requestRoute.useParams();
  const queryClient = useQueryClient();
  useDocumentTitle(t("sharing.requests.title"));
  const entry = useQuery({
    queryKey: ["accessRequests", requestId],
    queryFn: () =>
      request(() => api.GET("/api/v1/access-requests/{requestId}", { params: { path: { requestId } } })),
    throwOnError: false,
  });
  const own = entry.data?.requester.id === session.account?.id;
  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader title={t("sharing.requests.title")} icon={KeyRound} />
        {entry.isPending ? <Skeleton className="h-card w-full" /> : null}
        {entry.isError ? (
          <LoadError
            what={t("sharing.requests.oneFailed")}
            error={entry.error}
            onRetry={() => entry.refetch()}
          />
        ) : null}
        {entry.data ? (
          <AccessRequestCard
            entry={entry.data}
            canDecide={!own}
            onChanged={(next) => queryClient.setQueryData(["accessRequests", requestId], next)}
          />
        ) : null}
        {own ? (
          <Link to="/access-requests" className="self-start text-accent underline focus-visible:focus-ring">
            {t("sharing.requests.mineLink")}
          </Link>
        ) : null}
      </div>
    </main>
  );
}

export function SpaceAccessRequests({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const requests = useQuery({
    queryKey: sharingKeys.requests(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/access-requests", { params: { path: { spaceId } } })),
    throwOnError: false,
  });
  if (requests.isPending) return <Skeleton className="h-card w-full" />;
  if (requests.isError) {
    return (
      <LoadError
        what={t("sharing.requests.loadFailed")}
        error={requests.error}
        onRetry={() => requests.refetch()}
      />
    );
  }
  if (requests.data.length === 0)
    return <p className="text-sm text-text-muted">{t("sharing.requests.noneOpen")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {requests.data.map((entry) => (
        <AccessRequestCard key={entry.id} entry={entry} canDecide />
      ))}
    </div>
  );
}
