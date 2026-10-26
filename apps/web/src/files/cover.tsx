import { Field, Select, Skeleton } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { SaveIndicator, useSaveState } from "../components/auto-save.js";
import { attachmentsQuery, contentUrl } from "./attachments-api.js";

export interface Cover {
  attachmentId: string;
  focusX: number;
  focusY: number;
}

const STEP = 0.05;
const NONE = "none";

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

export function CoverImage({ cover, alt, className }: { cover: Cover; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === cover.attachmentId) return null;
  return (
    <img
      src={contentUrl(cover.attachmentId, { size: "display" })}
      onError={() => setFailed(cover.attachmentId)}
      alt={alt}
      className={`object-cover ${className ?? ""}`}
      style={{ objectPosition: `${cover.focusX * 100}% ${cover.focusY * 100}%` }}
    />
  );
}

export function CoverEditor({
  postId,
  itemId,
  cover,
  onChanged,
}: {
  postId: string;
  itemId: string;
  cover: Cover | null;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const tracker = useSaveState();
  const queryClient = useQueryClient();
  const attachments = useQuery({ ...attachmentsQuery(itemId), throwOnError: false });
  const [local, setLocal] = useState<Cover | null>(cover);
  const images = (attachments.data ?? []).filter(
    (attachment) => attachment.preview === "image" && !attachment.tooLargeForPreview,
  );

  const save = (next: Cover | null) => {
    const previous = local;
    setLocal(next);
    void tracker
      .run(async () => {
        await request(() =>
          api.PUT("/api/v1/blog-posts/{postId}/cover", {
            params: { path: { postId } },
            body: next ? next : { attachmentId: null },
          }),
        );
        await onChanged();
        await queryClient.invalidateQueries({ queryKey: ["blog"] });
      })
      .then((saved) => {
        if (!saved) setLocal(previous);
      });
  };

  const placeFocus = (event: MouseEvent<HTMLButtonElement>) => {
    if (!local) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    save({
      ...local,
      focusX: clamp((event.clientX - box.left) / box.width),
      focusY: clamp((event.clientY - box.top) / box.height),
    });
  };

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!local) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    save({ ...local, focusX: clamp(local.focusX + move[0]), focusY: clamp(local.focusY + move[1]) });
  };

  if (attachments.isPending) return <Skeleton className="h-12 w-full" />;
  return (
    <section
      aria-labelledby="cover-editor"
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="cover-editor" className="min-w-0 flex-1 font-semibold">
          {t("blog.cover.title")}
        </h2>
        <SaveIndicator tracker={tracker} />
      </div>
      <Field
        label={t("blog.cover.image")}
        hint={images.length === 0 ? t("blog.cover.noImages") : t("blog.cover.imageHint")}
      >
        <Select
          value={local?.attachmentId ?? NONE}
          options={[
            { value: NONE, label: t("blog.cover.none") },
            ...images.map((image) => ({ value: image.id, label: image.name })),
          ]}
          onValueChange={(value) =>
            save(value === NONE ? null : { attachmentId: value, focusX: 0.5, focusY: 0.5 })
          }
        />
      </Field>
      {local ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">{t("blog.cover.focusHint")}</p>
          <button
            type="button"
            aria-label={t("blog.cover.focus", {
              x: Math.round(local.focusX * 100),
              y: Math.round(local.focusY * 100),
            })}
            onClick={placeFocus}
            onKeyDown={moveFocus}
            className="relative block w-full overflow-hidden rounded-md focus-visible:focus-ring"
          >
            <img src={contentUrl(local.attachmentId, { size: "display" })} alt="" className="block w-full" />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface p-1 text-accent shadow-popover"
              style={{ left: `${local.focusX * 100}%`, top: `${local.focusY * 100}%` }}
            >
              <Crosshair className="size-icon-md" />
            </span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <p className="text-sm text-text-muted">{t("blog.cover.wide")}</p>
            <p className="text-sm text-text-muted">{t("blog.cover.square")}</p>
            <CoverImage cover={local} alt="" className="aspect-video w-full rounded-md" />
            <CoverImage cover={local} alt="" className="aspect-square w-1/2 rounded-md" />
          </div>
        </div>
      ) : null}
    </section>
  );
}
