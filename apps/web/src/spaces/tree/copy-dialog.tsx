import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  Field,
  Notice,
  RadioGroup,
  Select,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { isApiError, request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { ImpactSummary } from "../access/impact.js";
import { itemHref } from "../item-paths.js";
import { spaceDisplayName } from "../space-badge.js";
import type { CopiedItem } from "../space-context.js";
import {
  type CopyImpact,
  type ItemCopy,
  itemQuery,
  type SpaceWithRole,
  spaceKeys,
} from "../space-queries.js";

const ROOT = "root";
const REFRESH_MS = 2000;
const COPY_ERRORS = new Set(["copyChangesAccess", "storageFull", "copyInterrupted"]);

export function copyImpactOf(error: unknown): CopyImpact | null {
  return isApiError(error, "copyChangesAccess") ? (error.problem.copyImpact ?? null) : null;
}

export function CopyDialog({
  space,
  item,
  onOpenChange,
}: {
  space: SpaceWithRole;
  item: CopiedItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [running, setRunning] = useState<ItemCopy | null>(null);
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) setRunning(null);
        onOpenChange(open);
      }}
      title={
        item
          ? running
            ? t("copy.running", { title: item.title })
            : t("copy.title", { title: item.title })
          : ""
      }
      description={running ? t("copy.closeHint") : t("copy.description")}
      size="md"
    >
      {item && running ? (
        <CopyProgress
          copy={running}
          sourceSpaceId={space.id}
          onDone={() => {
            setRunning(null);
            onOpenChange(false);
          }}
        />
      ) : item ? (
        <CopyForm
          key={item.id}
          space={space}
          item={item}
          onQueued={setRunning}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

const COPY_TARGETS = ["spaces", "list", "copy"];

function useFinished() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async (copy: ItemCopy, sourceSpaceId: string) => {
    await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
    const target = copy.item;
    if (!target) return;
    const left = copy.hidden + copy.skipped;
    const listed = queryClient
      .getQueryData<{ items: (Parameters<typeof spaceDisplayName>[1] & { id: string })[] }>(COPY_TARGETS)
      ?.items.find((entry) => entry.id === target.spaceId);
    toast({
      title:
        target.spaceId === sourceSpaceId
          ? t("copy.copied", { title: copy.title })
          : t("copy.copiedToSpace", {
              title: copy.title,
              space: listed ? spaceDisplayName(t, listed) : target.spaceKey,
            }),
      ...(left > 0 ? { description: t("copy.left", { count: left }) } : {}),
      variant: "success",
    });
    const href = itemHref({ ...target, link: null }, target.spaceKey);
    if (href) await navigate({ to: href });
  };
}

function CopyProgress({
  copy,
  sourceSpaceId,
  onDone,
}: {
  copy: ItemCopy;
  sourceSpaceId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const finished = useFinished();
  const shown = useRef(false);
  const status = useQuery({
    queryKey: ["copies", copy.id],
    queryFn: () =>
      request(() => api.GET("/api/v1/copies/{copyId}", { params: { path: { copyId: copy.id } } })),
    initialData: copy,
    refetchInterval: (query) =>
      query.state.data?.state === "queued" || query.state.data?.state === "running" ? REFRESH_MS : false,
  });
  const current = status.data;
  useEffect(() => {
    if (current.state !== "done" || shown.current) return;
    shown.current = true;
    void finished(current, sourceSpaceId).then(onDone);
  }, [current, finished, sourceSpaceId, onDone]);
  const percent =
    current.progress.total > 0
      ? Math.min(100, Math.round((current.progress.done / current.progress.total) * 100))
      : 0;
  return (
    <div className="flex flex-col gap-4">
      {current.state === "failed" ? (
        <Notice variant="danger" title={t("copy.jobFailed")}>
          {translateKey(
            t,
            `copy.errors.${current.errorCode && COPY_ERRORS.has(current.errorCode) ? current.errorCode : "other"}`,
          )}
        </Notice>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label={t("copy.running", { title: current.title })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className="h-full bg-accent transition-[width] motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-sm text-text-muted">
            {t("copy.progress", { done: current.progress.done, total: current.progress.total })}
          </p>
        </div>
      )}
      {status.isError ? (
        <LoadError what={t("copy.statusFailed")} error={status.error} onRetry={() => status.refetch()} />
      ) : null}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          {t("copy.close")}
        </Button>
      </div>
    </div>
  );
}

function CopyForm({
  space,
  item,
  onQueued,
  onDone,
}: {
  space: SpaceWithRole;
  item: CopiedItem;
  onQueued: (copy: ItemCopy) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const finished = useFinished();
  const confirmId = useId();
  const writable = (entry: SpaceWithRole) =>
    (entry.role === "editor" || entry.role === "admin") && !entry.archived;
  const [targetSpaceId, setTargetSpaceId] = useState(writable(space) ? space.id : "");
  const currentParent = useQuery({ ...itemQuery(item.parentId ?? ""), enabled: item.parentId !== null });
  const [chosenParent, setParent] = useState<{ value: string; label: string } | null>(null);
  const sameSpace = targetSpaceId === space.id;
  const parent =
    chosenParent ??
    (sameSpace && item.parentId
      ? { value: item.parentId, label: currentParent.data?.title ?? "" }
      : { value: ROOT, label: t("copy.topLevel") });
  const [position, setPosition] = useState<"first" | "last">("last");
  const [descendants, setDescendants] = useState(item.kind === "folder");
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [widerError, setWiderError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const spaces = useQuery({
    queryKey: COPY_TARGETS,
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces", { params: { query: { limit: 200, role: "editor" } } })),
  });
  const targets = spaces.data?.items ?? [];
  const chosenSpaceId = targetSpaceId || targets[0]?.id || "";
  const targetSpace = targets.find((entry) => entry.id === chosenSpaceId) ?? null;
  const parentId = parent.value === ROOT ? null : parent.value;
  const withDescendants = item.kind === "folder" || (item.kind === "page" && descendants);
  const impactKey = ["items", item.id, "copyImpact", chosenSpaceId, parentId, withDescendants];
  const impact = useQuery({
    queryKey: impactKey,
    enabled: chosenSpaceId !== "",
    queryFn: () =>
      request(() =>
        api.POST("/api/v1/items/{itemId}/copy/preview", {
          params: { path: { itemId: item.id } },
          body: { spaceId: chosenSpaceId, parentId, descendants: withDescendants },
        }),
      ),
    retry: false,
    throwOnError: false,
  });

  const wider = confirmedFor !== null && confirmedFor === impact.data?.confirmation;

  const loadParents = async (query: string) => {
    const found = await request(() =>
      api.GET("/api/v1/items", {
        params: { query: { spaceId: chosenSpaceId, limit: 20, ...(query ? { q: query } : {}) } },
      }),
    );
    return {
      items: [
        { value: ROOT, label: t("copy.topLevel") },
        ...found.map((candidate) => ({
          value: candidate.id,
          label: candidate.title,
          description: candidate.kind === "folder" ? t("copy.folder") : t("copy.page"),
        })),
      ],
    };
  };

  const submit = async () => {
    setFailure(null);
    setWiderError(null);
    if (impact.data?.widerAccess && !wider) {
      setWiderError(t("copy.widerRequired"));
      document.getElementById(confirmId)?.querySelector<HTMLElement>("[role=checkbox]")?.focus();
      return;
    }
    setCopying(true);
    try {
      let beforeId: string | undefined;
      if (position === "first") {
        const children = await request(() =>
          api.GET("/api/v1/spaces/{spaceId}/items", {
            params: {
              path: { spaceId: chosenSpaceId },
              query: { limit: 1, ...(parentId ? { parentId } : {}) },
            },
          }),
        );
        beforeId = children.items[0]?.id;
      }
      const copy = await request(() =>
        api.POST("/api/v1/items/{itemId}/copy", {
          params: { path: { itemId: item.id } },
          body: {
            spaceId: chosenSpaceId,
            parentId,
            descendants: withDescendants,
            ...(beforeId ? { beforeId } : {}),
            ...(impact.data?.confirmation ? { confirmation: impact.data.confirmation } : {}),
          },
        }),
      );
      if (copy.state === "done") {
        await finished(copy, space.id);
        onDone();
      } else onQueued(copy);
    } catch (error) {
      const changed = copyImpactOf(error);
      if (changed) {
        queryClient.setQueryData(impactKey, changed);
        setConfirmedFor(null);
        setFailure(t("copy.accessChanged"));
      } else setFailure(problemMessage(t, error));
    } finally {
      setCopying(false);
    }
  };

  if (spaces.isSuccess && targets.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Notice variant="info" title={t("copy.failed")}>
          {t("copy.noSpace")}
        </Notice>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onDone}>
            {t("copy.close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {failure ? (
        <Notice variant="danger" title={t("copy.failed")}>
          {failure}
        </Notice>
      ) : null}
      <Field label={t("copy.space")}>
        {spaces.isPending ? (
          <Skeleton className="h-control-md w-full" />
        ) : (
          <Select
            value={chosenSpaceId}
            onValueChange={(value) => {
              setTargetSpaceId(value);
              setParent({ value: ROOT, label: t("copy.topLevel") });
            }}
            options={targets.map((entry) => ({ value: entry.id, label: spaceDisplayName(t, entry) }))}
          />
        )}
      </Field>
      <Field label={t("copy.parent")} hint={t("copy.parentHint")}>
        <Combobox
          key={chosenSpaceId}
          aria-label={t("copy.parent")}
          value={parent.value}
          selectedItem={parent}
          load={loadParents}
          emptyText={t("copy.noMatch")}
          onValueChange={(value, selected) => {
            if (value && selected) setParent({ value, label: selected.label });
          }}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{t("copy.position")}</legend>
        <RadioGroup
          label={t("copy.position")}
          value={position}
          onValueChange={(value) => setPosition(value as "first" | "last")}
          options={[
            { value: "first", label: t("copy.first") },
            { value: "last", label: t("copy.last") },
          ]}
        />
      </fieldset>
      {item.kind === "page" && item.hasChildren ? (
        <Checkbox checked={descendants} onCheckedChange={setDescendants} label={t("copy.descendants")} />
      ) : null}
      <section aria-label={t("copy.access")} className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("copy.access")}</h3>
        {impact.isPending && chosenSpaceId !== "" ? <Skeleton className="h-control-md w-full" /> : null}
        {impact.isError ? (
          <LoadError what={t("copy.impactFailed")} error={impact.error} onRetry={() => impact.refetch()} />
        ) : null}
        {impact.data ? (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              <li>{t("copy.items", { count: impact.data.items })}</li>
              {impact.data.hidden > 0 ? <li>{t("copy.hidden", { count: impact.data.hidden })}</li> : null}
              {impact.data.skipped > 0 ? <li>{t("copy.skipped", { count: impact.data.skipped })}</li> : null}
            </ul>
            <ImpactSummary
              impact={impact.data}
              texts={{
                noChangeTitle: t("copy.impact.noChangeTitle"),
                noChange: t("copy.impact.noChange"),
                gaining: (count) => t("copy.impact.gaining", { count }),
                losing: (count) => t("copy.impact.losing", { count }),
                changing: (count) => t("copy.impact.changing", { count }),
              }}
            />
          </>
        ) : null}
        {impact.data?.leavesConfidential ? (
          <Notice variant="warning" title={t("confidential.copyOutTitle")}>
            {t("confidential.copyOut")}
          </Notice>
        ) : null}
        {impact.data?.widerAccess ? (
          <Notice variant="warning" title={t("copy.widerTitle")}>
            <div className="flex flex-col gap-3">
              <p>{t("copy.wider")}</p>
              <div id={confirmId}>
                <Checkbox
                  checked={wider}
                  onCheckedChange={(checked) => {
                    setConfirmedFor(checked ? (impact.data?.confirmation ?? null) : null);
                    if (checked) setWiderError(null);
                  }}
                  label={t("copy.widerConfirm")}
                  {...(widerError ? { error: widerError } : {})}
                />
              </div>
            </div>
          </Notice>
        ) : null}
        {impact.data?.background ? (
          <Notice variant="info" title={t("copy.contents")}>
            {t("copy.background")}
          </Notice>
        ) : null}
      </section>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={copying}>
          {targetSpace && targetSpace.id !== space.id
            ? t("copy.submitToSpace", { space: spaceDisplayName(t, targetSpace) })
            : t("copy.submit")}
        </Button>
      </div>
    </form>
  );
}
