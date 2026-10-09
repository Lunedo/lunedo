import {
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  Notice,
  RadioGroup,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { HolderPicker } from "../spaces/access/holders.js";
import { useSpace } from "../spaces/space-context.js";
import { spaceKeys } from "../spaces/space-queries.js";
import { accessRoleLabel } from "./explanation.js";
import { PageImpactSummary } from "./page-impact.js";
import { changeAccess, type GiveEffect, type PageImpact, sharingKeys } from "./sharing-api.js";

type Level = "reader" | "commenter" | "editor" | "admin";
type Where = "space" | "page" | "pageAndChildren";

interface Draft {
  step: number;
  holder: { kind: "account" | "group"; id: string; name: string } | null;
  level: Level;
  where: Where;
  page: { id: string; title: string } | null;
}

const STEPS = ["who", "what", "where", "check"] as const;
const EMPTY: Draft = { step: 0, holder: null, level: "reader", where: "space", page: null };

const SAVE_DELAY_MS = 500;

function draftQuery(spaceId: string) {
  return queryOptions({
    queryKey: ["giveAccessDraft", spaceId],
    queryFn: async () =>
      (
        await request(() =>
          api.GET("/api/v1/spaces/{spaceId}/give-access/draft", { params: { path: { spaceId } } }),
        )
      ).draft,
  });
}

function saveDraft(spaceId: string, draft: Draft) {
  return request(() =>
    api.PUT("/api/v1/spaces/{spaceId}/give-access/draft", { params: { path: { spaceId } }, body: draft }),
  );
}

function discardDraft(spaceId: string) {
  return request(() =>
    api.DELETE("/api/v1/spaces/{spaceId}/give-access/draft", { params: { path: { spaceId } } }),
  );
}

function isPageImpact(impact: GiveEffect["impact"]): impact is PageImpact {
  return "read" in impact;
}

function Preview({ spaceId, draft }: { spaceId: string; draft: Draft }) {
  const { t } = useTranslation();
  const holder = draft.holder;
  const effect = useQuery({
    queryKey: ["giveAccess", spaceId, draft.holder?.id, draft.level, draft.where, draft.page?.id],
    enabled: holder !== null,
    gcTime: 0,
    throwOnError: false,
    queryFn: () => {
      const body = {
        holderKind: holder?.kind ?? "account",
        holderId: holder?.id ?? "",
        level: draft.level,
        scope: draft.where,
      };
      if (draft.where === "space") {
        return request(() =>
          api.POST("/api/v1/spaces/{spaceId}/give-access/preview", { params: { path: { spaceId } }, body }),
        );
      }
      return request(() =>
        api.POST("/api/v1/pages/{pageId}/give-access/preview", {
          params: { path: { pageId: draft.page?.id ?? "" } },
          body,
        }),
      );
    },
  });
  if (!holder) return null;
  if (effect.isPending) return <Skeleton className="h-card w-full" />;
  if (effect.isError) {
    return (
      <LoadError
        what={t("sharing.give.previewFailed")}
        error={effect.error}
        onRetry={() => effect.refetch()}
      />
    );
  }
  const data = effect.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-semibold">
        {t("sharing.give.effect", { name: holder.name, readable: data.readable, editable: data.editable })}
      </p>
      {data.restricted > 0 ? (
        <Notice variant="info" title={t("sharing.give.restrictedTitle")}>
          {t("sharing.give.restricted", { name: holder.name, count: data.restricted })}
        </Notice>
      ) : null}
      {data.alreadyHas ? (
        <p className="text-sm text-text-muted">
          {t("sharing.give.alreadyHas", { name: holder.name, role: accessRoleLabel(t, data.alreadyHas) })}
        </p>
      ) : null}
      {isPageImpact(data.impact) ? (
        <PageImpactSummary impact={data.impact} />
      ) : data.impact.gaining + data.impact.raised > 0 ? (
        <p className="text-sm">
          {t("sharing.give.spaceImpact", { count: data.impact.gaining + data.impact.raised })}
        </p>
      ) : (
        <Notice variant="info" title={t("sharing.impact.noChangeTitle")}>
          {t("sharing.give.noChange")}
        </Notice>
      )}
    </div>
  );
}

function PagePicker({
  spaceId,
  value,
  onChange,
  invalid,
}: {
  spaceId: string;
  value: Draft["page"];
  onChange: (page: Draft["page"]) => void;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const load = async (query: string) => {
    const found = await request(() =>
      api.GET("/api/v1/items", { params: { query: { q: query, spaceId, kind: "page", limit: 20 } } }),
    );
    return { items: found.map((item): ComboboxItem => ({ value: item.id, label: item.title })) };
  };
  return (
    <Combobox
      aria-label={t("sharing.give.page")}
      placeholder={t("sharing.give.pagePlaceholder")}
      emptyText={t("sharing.give.noPage")}
      value={value?.id ?? null}
      selectedItem={value ? { value: value.id, label: value.title } : null}
      invalid={invalid}
      load={load}
      onValueChange={(next, item) => onChange(next && item ? { id: next, title: item.label } : null)}
    />
  );
}

function useDraftSaving(spaceId: string, draft: Draft) {
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<unknown>(null);
  const saved = useRef(JSON.stringify(draft));
  const latest = useRef(draft);
  const stopped = useRef(false);
  latest.current = draft;

  const persist = useCallback(
    (value: Draft) => {
      const text = JSON.stringify(value);
      if (stopped.current || text === saved.current) return;
      saveDraft(spaceId, value)
        .then(() => {
          saved.current = text;
          setSaveError(null);
          if (!stopped.current) queryClient.setQueryData(draftQuery(spaceId).queryKey, value);
        })
        .catch(setSaveError);
    },
    [spaceId, queryClient],
  );

  useEffect(() => {
    const timer = setTimeout(() => persist(draft), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, persist]);

  useEffect(() => () => persist(latest.current), [persist]);

  return {
    saveError,
    retry: () => persist(latest.current),
    stop: () => {
      stopped.current = true;
    },
  };
}

function Assistant({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const saving = useDraftSaving(space.id, draft);
  const update = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  const finish = async () => {
    saving.stop();
    await discardDraft(space.id);
    queryClient.setQueryData(draftQuery(space.id).queryKey, null);
  };

  const cancel = async () => {
    setDiscarding(true);
    try {
      await finish();
      onClose();
    } catch (problem) {
      toast({
        title: t("sharing.give.discardFailed"),
        description: problemMessage(t, problem),
        variant: "error",
      });
    } finally {
      setDiscarding(false);
    }
  };
  const levels: Level[] =
    draft.where === "space" ? ["reader", "commenter", "editor", "admin"] : ["reader", "commenter", "editor"];

  const validate = (): string | null => {
    if (draft.step === 0 && !draft.holder) return t("sharing.give.chooseHolder");
    if (draft.step === 2 && draft.where !== "space" && !draft.page) return t("sharing.give.choosePage");
    if (draft.step === 2 && draft.where !== "space" && draft.level === "admin")
      return t("sharing.give.adminSpaceOnly");
    return null;
  };

  const next = () => {
    const problem = validate();
    setError(problem);
    if (problem) {
      body.current?.querySelector<HTMLElement>("input, [role='radio']")?.focus();
      return;
    }
    update({ step: Math.min(draft.step + 1, STEPS.length - 1) });
  };

  const confirm = async () => {
    const holder = draft.holder;
    if (!holder) return;
    setBusy(true);
    setFailure(null);
    try {
      if (draft.where === "space") {
        await request(() =>
          api.POST("/api/v1/spaces/{spaceId}/permissions", {
            params: { path: { spaceId: space.id } },
            body: { action: "grant", principalKind: holder.kind, principalId: holder.id, role: draft.level },
          }),
        );
        await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      } else if (draft.page) {
        const pageId = draft.page.id;
        const access = await request(() =>
          api.GET("/api/v1/pages/{pageId}/access", { params: { path: { pageId } } }),
        );
        const existing = access.shares.find(
          (share) => share.holder.kind === holder.kind && share.holder.id === holder.id,
        );
        const role = draft.level === "admin" ? "editor" : draft.level;
        const includeDescendants = draft.where === "pageAndChildren";
        await changeAccess(pageId, [
          existing
            ? { action: "changeShare", shareId: existing.id, role, includeDescendants }
            : { action: "share", holderKind: holder.kind, holderId: holder.id, role, includeDescendants },
        ]);
        await queryClient.invalidateQueries({ queryKey: sharingKeys.access(pageId) });
      }
      toast({ title: t("sharing.give.done", { name: holder.name }), variant: "success" });
      await finish().catch(() => undefined);
      onClose();
    } catch (problem) {
      setFailure(problemMessage(t, problem));
    } finally {
      setBusy(false);
    }
  };

  const step = STEPS[draft.step] ?? "who";
  return (
    <div className="flex flex-col gap-5">
      <ol aria-label={t("sharing.give.progress")} className="flex flex-wrap gap-2">
        {STEPS.map((name, index) => (
          <li
            key={name}
            aria-current={index === draft.step ? "step" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              index === draft.step
                ? "border-accent font-semibold text-text"
                : index < draft.step
                  ? "border-border text-text"
                  : "border-border text-text-muted"
            }`}
          >
            {t("sharing.give.stepLabel", {
              number: index + 1,
              name: translateKey(t, `sharing.give.steps.${name}`),
            })}
          </li>
        ))}
      </ol>
      <div ref={body} className="flex flex-col gap-4">
        {step === "who" ? (
          <Field label={t("sharing.give.who")} hint={t("sharing.give.whoHint")} error={error}>
            <HolderPicker
              organizationId={space.organizationId}
              organizationName={space.organizationName}
              personal
              groups={!space.confidential}
              exclude={[]}
              value={draft.holder ? `${draft.holder.kind}:${draft.holder.id}` : null}
              onValueChange={(holder) => {
                setError(null);
                update({
                  holder:
                    holder?.principalId &&
                    (holder.principalKind === "account" || holder.principalKind === "group")
                      ? { kind: holder.principalKind, id: holder.principalId, name: holder.name }
                      : null,
                });
              }}
              label={t("sharing.give.who")}
              invalid={error !== null}
            />
          </Field>
        ) : null}
        {step === "what" ? (
          <RadioGroup
            label={t("sharing.give.what")}
            variant="card"
            value={draft.level}
            onValueChange={(value) => update({ level: value as Level })}
            options={levels.map((value) => ({
              value,
              label: accessRoleLabel(t, value),
              description: translateKey(t, `sharing.give.levels.${value}`),
            }))}
          />
        ) : null}
        {step === "where" ? (
          <>
            <RadioGroup
              label={t("sharing.give.where")}
              variant="card"
              value={draft.where}
              onValueChange={(value) => {
                setError(null);
                update({
                  where: value as Where,
                  ...(value !== "space" && draft.level === "admin" ? { level: "editor" } : {}),
                });
              }}
              options={(["space", "page", "pageAndChildren"] as const).map((value) => ({
                value,
                label: translateKey(t, `sharing.give.places.${value}`, { space: space.name }),
                description: translateKey(t, `sharing.give.placeHints.${value}`),
              }))}
            />
            {draft.where !== "space" ? (
              <Field label={t("sharing.give.page")} error={error}>
                <PagePicker
                  spaceId={space.id}
                  value={draft.page}
                  invalid={error !== null}
                  onChange={(page) => {
                    setError(null);
                    update({ page });
                  }}
                />
              </Field>
            ) : null}
          </>
        ) : null}
        {saving.saveError ? (
          <Notice variant="warning" title={t("sharing.give.saveFailedTitle")}>
            <span className="flex flex-wrap items-center gap-2">
              {t("sharing.give.saveFailed", { reason: problemMessage(t, saving.saveError) })}
              <Button size="sm" variant="secondary" onClick={saving.retry}>
                {t("errors.retry")}
              </Button>
            </span>
          </Notice>
        ) : null}
        {step === "check" ? (
          <>
            <Preview spaceId={space.id} draft={draft} />
            {failure ? (
              <Notice variant="danger" title={t("sharing.give.failed")}>
                {failure}
              </Notice>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={X} loading={discarding} onClick={() => void cancel()}>
            {t("sharing.give.cancel")}
          </Button>
          {draft.step > 0 ? (
            <Button variant="secondary" icon={ArrowLeft} onClick={() => update({ step: draft.step - 1 })}>
              {t("sharing.give.back")}
            </Button>
          ) : null}
        </div>
        {step === "check" ? (
          <Button variant="primary" icon={Check} loading={busy} onClick={() => void confirm()}>
            {t("sharing.give.confirm", {
              name: draft.holder?.name ?? "",
              role: accessRoleLabel(
                t,
                draft.where === "space" ? draft.level : draft.level === "admin" ? "editor" : draft.level,
              ),
            })}
          </Button>
        ) : (
          <Button variant="primary" icon={ArrowRight} onClick={next}>
            {t("sharing.give.next")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function GiveAccessButton({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const stored = useQuery({ ...draftQuery(spaceId), throwOnError: false });
  const draft = stored.data ?? null;
  return (
    <>
      <Button variant="primary" icon={UserPlus} onClick={() => setOpen(true)}>
        {draft ? t("sharing.give.continue") : t("sharing.give.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title={t("sharing.give.title")}
        description={t("sharing.give.description")}
      >
        {open ? (
          stored.isPending ? (
            <Skeleton className="h-card w-full" />
          ) : (
            <Assistant initial={{ ...EMPTY, ...draft }} onClose={() => setOpen(false)} />
          )
        ) : null}
      </Dialog>
    </>
  );
}
