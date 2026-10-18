import { Button, SkeletonText } from "@pagehall/ui";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Network, Pencil } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { useOpenPath } from "../editor/context.js";
import { LoadError } from "../errors/failure.js";
import { contentUrl } from "../files/attachments-api.js";

export function referencedDiagramQuery(pageId: string, diagramId: string) {
  return queryOptions({
    queryKey: ["diagrams", "referenced", pageId, diagramId] as const,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/pages/{pageId}/diagrams/{blockId}", {
          params: { path: { pageId, blockId: diagramId } },
        }),
      ),
    retry: false,
  });
}

function hidden(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

function Muted({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="p-4 text-sm text-text-muted">
      <p>{text}</p>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

export function ReferencedDiagram({
  pageId,
  diagramId,
  name,
  framed = false,
}: {
  pageId: string | null;
  diagramId: string | null;
  name: string;
  framed?: boolean;
}) {
  const { t } = useTranslation();
  const open = useOpenPath();
  const known = pageId !== null && diagramId !== null;
  const diagram = useQuery({
    ...referencedDiagramQuery(pageId ?? "", diagramId ?? ""),
    enabled: known,
    throwOnError: false,
  });
  const label = t("editor.drawio.label");
  const data = diagram.data;
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!data || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    open(data.path);
  };

  let body: ReactNode;
  if (!known) body = <Muted text={t("editor.drawioReference.notImported", { name })} />;
  else if (diagram.isPending) {
    body = (
      <div className="p-4">
        <SkeletonText lines={3} />
      </div>
    );
  } else if (diagram.isError) {
    body = hidden(diagram.error) ? (
      <Muted
        text={t("editor.drawioReference.restricted")}
        hint={t("editor.drawioReference.restrictedHint")}
      />
    ) : (
      <div className="p-3">
        <LoadError
          what={t("editor.drawioReference.loadFailed")}
          error={diagram.error}
          onRetry={diagram.refetch}
        />
      </div>
    );
  } else if (!diagram.data.found) body = <Muted text={t("editor.drawioReference.removed")} />;
  else if (diagram.data.previewId && diagram.data.previewVersion !== null) {
    body = (
      <img
        src={contentUrl(diagram.data.previewId, { version: diagram.data.previewVersion })}
        alt={label}
        loading="lazy"
        draggable={false}
        className="mx-auto max-w-full bg-surface"
      />
    );
  } else body = <Muted text={t("editor.drawio.emptyReadOnly")} />;

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <Network aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
        <span className="font-semibold">{t("editor.drawioReference.label")}</span>
        <span className="flex-1" />
        {data ? (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => open(data.path, { edit: true })}>
            {t("editor.drawioReference.edit")}
          </Button>
        ) : null}
      </div>
      {body}
      {data ? (
        <p className="border-t border-border px-3 py-2 text-sm text-text-muted">
          <a href={data.path} onClick={follow}>
            {t("editor.drawioReference.from", { title: data.title || t("editor.readView.untitledPage") })}
          </a>
        </p>
      ) : null}
    </>
  );
  return framed ? (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface">{content}</div>
  ) : (
    content
  );
}
