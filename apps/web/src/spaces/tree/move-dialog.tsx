import { Button, Combobox, Dialog, Field, Notice, RadioGroup, Select, Skeleton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { ImpactSummary } from "../access/impact.js";
import { spaceDisplayName } from "../space-badge.js";
import { itemQuery, type SpaceWithRole, spaceKeys, type TreeItem } from "../space-queries.js";
import { moveImpactOf } from "./move-confirmation.js";

const ROOT = "root";

export function MoveDialog({
  space,
  item,
  onOpenChange,
}: {
  space: SpaceWithRole;
  item: Pick<TreeItem, "id" | "title" | "kind" | "spaceId" | "parentId"> | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={item !== null}
      onOpenChange={onOpenChange}
      title={item ? t("move.title", { title: item.title }) : ""}
      description={t("move.description")}
      size="md"
    >
      {item ? <MoveForm key={item.id} space={space} item={item} onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function MoveForm({
  space,
  item,
  onDone,
}: {
  space: SpaceWithRole;
  item: Pick<TreeItem, "id" | "title" | "kind" | "spaceId" | "parentId">;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetSpaceId, setTargetSpaceId] = useState(space.id);
  const currentParent = useQuery({ ...itemQuery(item.parentId ?? ""), enabled: item.parentId !== null });
  const [chosenParent, setParent] = useState<{ value: string; label: string } | null>(null);
  const parent =
    chosenParent ??
    (item.parentId
      ? { value: item.parentId, label: currentParent.data?.title ?? "" }
      : { value: ROOT, label: t("move.topLevel") });
  const [position, setPosition] = useState<"first" | "last">("last");
  const [failure, setFailure] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const spaces = useQuery({
    queryKey: ["spaces", "list", "move"],
    queryFn: () => request(() => api.GET("/api/v1/spaces", { params: { query: { limit: 200 } } })),
  });
  const crossSpace = targetSpaceId !== space.id;
  const parentId = parent.value === ROOT ? null : parent.value;
  const impactKey = ["items", item.id, "moveImpact", targetSpaceId, parentId];
  const impact = useQuery({
    queryKey: impactKey,
    queryFn: () =>
      request(() =>
        api.POST("/api/v1/items/{itemId}/move/preview", {
          params: { path: { itemId: item.id } },
          body: { ...(crossSpace ? { spaceId: targetSpaceId } : {}), parentId },
        }),
      ),
    retry: false,
    throwOnError: false,
  });
  const targetSpace = spaces.data?.items.find((entry) => entry.id === targetSpaceId) ?? space;

  const loadParents = async (query: string) => {
    const found = await request(() =>
      api.GET("/api/v1/items", {
        params: { query: { spaceId: targetSpaceId, limit: 20, ...(query ? { q: query } : {}) } },
      }),
    );
    return {
      items: [
        { value: ROOT, label: t("move.topLevel") },
        ...found
          .filter((candidate) => candidate.id !== item.id)
          .map((candidate) => ({
            value: candidate.id,
            label: candidate.title,
            description: candidate.kind === "folder" ? t("move.folder") : t("move.page"),
          })),
      ],
    };
  };

  const submit = async () => {
    setFailure(null);
    setMoving(true);
    try {
      let beforeId: string | undefined;
      if (position === "first") {
        const children = await request(() =>
          api.GET("/api/v1/spaces/{spaceId}/items", {
            params: {
              path: { spaceId: targetSpaceId },
              query: { limit: 2, ...(parentId ? { parentId } : {}) },
            },
          }),
        );
        beforeId = children.items.find((child) => child.id !== item.id)?.id;
      }
      await request(() =>
        api.POST("/api/v1/items/{itemId}/move", {
          params: { path: { itemId: item.id } },
          body: {
            parentId,
            ...(crossSpace ? { spaceId: targetSpaceId } : {}),
            ...(beforeId ? { beforeId } : {}),
            ...(impact.data?.confirmation ? { confirmation: impact.data.confirmation } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      await queryClient.invalidateQueries({ queryKey: spaceKeys.item(item.id) });
      toast({
        title: crossSpace
          ? t("move.movedToSpace", { title: item.title, space: spaceDisplayName(t, targetSpace) })
          : t("move.moved", { title: item.title }),
        variant: "success",
      });
      onDone();
    } catch (error) {
      const changed = moveImpactOf(error);
      if (changed) {
        queryClient.setQueryData(impactKey, changed);
        setFailure(t("move.accessChanged"));
      } else setFailure(problemMessage(t, error));
    } finally {
      setMoving(false);
    }
  };

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
        <Notice variant="danger" title={t("move.failed")}>
          {failure}
        </Notice>
      ) : null}
      <Field label={t("move.space")}>
        {spaces.isPending ? (
          <Skeleton className="h-control-md w-full" />
        ) : (
          <Select
            value={targetSpaceId}
            onValueChange={(value) => {
              setTargetSpaceId(value);
              setParent({ value: ROOT, label: t("move.topLevel") });
            }}
            options={(spaces.data?.items ?? [space])
              .filter(
                (entry) =>
                  entry.id === space.id ||
                  (!entry.personal && !space.personal && entry.organizationId === space.organizationId),
              )
              .map((entry) => ({
                value: entry.id,
                label: spaceDisplayName(t, entry),
              }))}
          />
        )}
      </Field>
      <Field label={t("move.parent")} hint={t("move.parentHint")}>
        <Combobox
          key={targetSpaceId}
          aria-label={t("move.parent")}
          value={parent.value}
          selectedItem={parent}
          load={loadParents}
          emptyText={t("move.noMatch")}
          onValueChange={(value, selected) => {
            if (value && selected) setParent({ value, label: selected.label });
          }}
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{t("move.position")}</legend>
        <RadioGroup
          label={t("move.position")}
          value={position}
          onValueChange={(value) => setPosition(value as "first" | "last")}
          options={[
            { value: "first", label: t("move.first") },
            { value: "last", label: t("move.last") },
          ]}
        />
      </fieldset>
      <section aria-label={t("move.accessChange")} className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("move.accessChange")}</h3>
        {impact.isPending ? <Skeleton className="h-control-md w-full" /> : null}
        {impact.isError ? (
          <LoadError what={t("move.impactFailed")} error={impact.error} onRetry={() => impact.refetch()} />
        ) : null}
        {impact.data ? <ImpactSummary impact={impact.data} /> : null}
        {impact.data?.leavesConfidential ? (
          <Notice variant="warning" title={t("confidential.moveOutTitle")}>
            {t("confidential.moveOut")}
          </Notice>
        ) : null}
      </section>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={moving}>
          {crossSpace
            ? t("move.submitToSpace", { space: spaceDisplayName(t, targetSpace) })
            : t("move.submit")}
        </Button>
      </div>
    </form>
  );
}
