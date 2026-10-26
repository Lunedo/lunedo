import { FRAMED_SECTIONS } from "@lunedo/editor-schema";
import { Button, Field, Input, Popover, Tooltip } from "@lunedo/ui";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Frame,
  ImageOff,
  type LucideIcon,
  TextQuote,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAttachmentUrl } from "../../files/attachment-source.js";
import { useEditable } from "../context.js";
import { useImageTooLarge } from "../references.js";

export const IMAGE_SIZES = [
  { id: "small", width: 33 },
  { id: "medium", width: 50 },
  { id: "large", width: 75 },
  { id: "full", width: 100 },
] as const;

const MIN_WIDTH = 10;

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const CORNERS: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export function resizedWidth(options: {
  startWidth: number;
  containerWidth: number;
  deltaX: number;
  corner: Corner;
  align: string;
}): number {
  const direction = options.corner.endsWith("left") ? -1 : 1;
  const factor = options.align === "center" ? 2 : 1;
  const pixels = options.startWidth + options.deltaX * direction * factor;
  const percent = Math.round((pixels * 100) / Math.max(1, options.containerWidth));
  return Math.min(100, Math.max(MIN_WIDTH, percent));
}

function inFramedSection(props: NodeViewProps): boolean {
  const position = props.getPos();
  if (typeof position !== "number") return false;
  const resolved = props.editor.state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const ancestor = resolved.node(depth);
    if (ancestor.type.name === "section") {
      return (FRAMED_SECTIONS as readonly string[]).includes(String(ancestor.attrs.key));
    }
  }
  return false;
}

function BarButton({
  label,
  icon: Icon,
  pressed,
  onClick,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  pressed?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className="ld-toolbar-button inline-flex h-control-sm min-w-control-sm items-center justify-center gap-1 rounded-sm px-2 text-sm font-medium text-text hover:bg-hover aria-pressed:bg-selected aria-pressed:text-selected-text focus-visible:focus-ring"
      >
        {Icon ? <Icon aria-hidden="true" className="size-icon-md" /> : null}
        {children}
      </button>
    </Tooltip>
  );
}

function AltText({ value, onSave }: { value: string; onSave: (alt: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(value);
      }}
      align="center"
      label={t("editor.image.altTitle")}
      trigger={
        <button
          type="button"
          aria-label={t("editor.image.altText")}
          aria-haspopup="dialog"
          onMouseDown={(event) => event.preventDefault()}
          className="ld-toolbar-button inline-flex h-control-sm min-w-control-sm items-center justify-center rounded-sm px-1 text-text hover:bg-hover focus-visible:focus-ring"
        >
          <TextQuote aria-hidden="true" className="size-icon-md" />
        </button>
      }
    >
      <form
        className="flex w-field flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft.trim());
          setOpen(false);
        }}
      >
        <Field label={t("editor.image.altTitle")} hint={t("editor.image.altHint")}>
          <Input value={draft} maxLength={1000} onChange={(event) => setDraft(event.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="sm">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

function ImageBar({ props, bar }: { props: NodeViewProps; bar: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const { node, updateAttributes, deleteNode, editor } = props;
  const width = typeof node.attrs.width === "number" ? node.attrs.width : null;
  const align = String(node.attrs.align ?? "center");
  const framed =
    node.attrs.frame === null || node.attrs.frame === undefined
      ? inFramedSection(props)
      : node.attrs.frame === true;
  const alignments: { value: string; icon: LucideIcon; label: string }[] = [
    { value: "left", icon: AlignLeft, label: t("editor.image.alignLeft") },
    { value: "center", icon: AlignCenter, label: t("editor.image.alignCenter") },
    { value: "right", icon: AlignRight, label: t("editor.image.alignRight") },
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      editor.commands.focus();
    }
  };
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={t("editor.image.bar")}
      className="ld-image-bar"
      onKeyDown={onKeyDown}
    >
      {IMAGE_SIZES.map((size) => (
        <BarButton
          key={size.id}
          label={t(`editor.image.sizes.${size.id}`, { percent: size.width })}
          pressed={width === size.width}
          onClick={() => updateAttributes({ width: size.width })}
        >
          {t(`editor.image.sizeShort.${size.id}`)}
        </BarButton>
      ))}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      {alignments.map((alignment) => (
        <BarButton
          key={alignment.value}
          label={alignment.label}
          icon={alignment.icon}
          pressed={align === alignment.value}
          onClick={() => updateAttributes({ align: alignment.value })}
        />
      ))}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <BarButton
        label={t("editor.image.frame")}
        icon={Frame}
        pressed={framed}
        onClick={() => updateAttributes({ frame: !framed })}
      />
      <AltText value={String(node.attrs.alt ?? "")} onSave={(alt) => updateAttributes({ alt })} />
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <BarButton label={t("editor.image.remove")} icon={Trash2} onClick={() => deleteNode()} />
    </div>
  );
}

export function ImageView(props: NodeViewProps) {
  const { node, selected, editor, updateAttributes } = props;
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const attachmentUrl = useAttachmentUrl();
  const id = typeof node.attrs.attachmentId === "string" ? node.attrs.attachmentId : null;
  const tooLarge = useImageTooLarge(id);
  const name = String(node.attrs.alt || "");
  const stored = typeof node.attrs.width === "number" ? node.attrs.width : null;
  const [dragging, setDragging] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const width = dragging ?? stored;
  const controls = editable && selected && id !== null && !tooLarge;

  useEffect(() => {
    if (!controls) return;
    const dom = editor.view.dom;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const first = bar.current?.querySelector<HTMLElement>("button");
      if (!first) return;
      event.preventDefault();
      event.stopPropagation();
      first.focus();
    };
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [controls, editor]);

  const startResize = (corner: Corner) => (event: PointerEvent<HTMLSpanElement>) => {
    const container = wrapper.current;
    const image = frame.current;
    if (!container || !image) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    const containerWidth = container.getBoundingClientRect().width;
    const align = String(node.attrs.align ?? "center");
    let latest = stored ?? Math.round((startWidth * 100) / Math.max(1, containerWidth));
    const move = (moving: globalThis.PointerEvent) => {
      latest = resizedWidth({ startWidth, containerWidth, deltaX: moving.clientX - startX, corner, align });
      setDragging(latest);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setDragging(null);
      updateAttributes({ width: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <NodeViewWrapper
      ref={wrapper}
      className={`ld-image${selected ? " ld-node-selected" : ""}`}
      data-align={String(node.attrs.align)}
      data-frame={node.attrs.frame === true ? "on" : node.attrs.frame === false ? "off" : undefined}
      {...(width !== null ? { "data-width": width } : {})}
      style={width !== null ? ({ "--image-width": `${width}%` } as CSSProperties) : undefined}
      contentEditable={false}
    >
      {controls ? <ImageBar props={props} bar={bar} /> : null}
      {id && tooLarge ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-text-muted">
            <ImageOff aria-hidden="true" className="size-icon-md shrink-0" />
            {t("editor.attachment.imageTooLarge", { name: name || t("editor.readView.image") })}
          </span>
          <a
            href={attachmentUrl(id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-hit items-center font-medium text-accent underline focus-visible:focus-ring"
          >
            {t("editor.attachment.openFullSize")}
          </a>
        </div>
      ) : id ? (
        <div ref={frame} className="ld-image-frame">
          <img src={attachmentUrl(id, undefined, "display")} alt={name} loading="lazy" draggable={false} />
          {controls
            ? CORNERS.map((corner) => (
                <span
                  key={corner}
                  aria-hidden="true"
                  data-corner={corner}
                  className="ld-image-handle"
                  onPointerDown={startResize(corner)}
                />
              ))
            : null}
          {dragging !== null ? (
            <span role="status" className="ld-image-size">
              {t("editor.image.size", { percent: dragging })}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="ld-image-empty flex min-h-hit items-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-text-muted">
          <ImageOff aria-hidden="true" className="size-icon-md" />
          {t("editor.attachment.missingImage")}
        </p>
      )}
    </NodeViewWrapper>
  );
}
