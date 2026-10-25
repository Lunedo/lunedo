import { INTRODUCTION_MAX_LENGTH, type IntroductionBlock, parseIntroduction } from "@lunedo/shared";
import { Field, IconButton, Textarea } from "@lunedo/ui";
import { Bold, Info, Italic, Link } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";

export function IntroductionPreview({ source }: { source: string }) {
  const blocks = parseIntroduction(source);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived from the text and have no identity
        <IntroductionBlockView key={index} block={block} />
      ))}
    </div>
  );
}

function IntroductionBlockView({ block }: { block: IntroductionBlock }) {
  const content: ReactNode[] = block.content.map((inline, index) => {
    const key = `${index}`;
    if (inline.type === "break") return <br key={key} />;
    if (inline.type === "link")
      return (
        <a key={key} href={inline.href} className="text-accent underline" target="_blank" rel="noreferrer">
          {inline.text}
        </a>
      );
    if (inline.bold) return <strong key={key}>{inline.text}</strong>;
    if (inline.italic) return <em key={key}>{inline.text}</em>;
    return <span key={key}>{inline.text}</span>;
  });
  return block.type === "callout" ? (
    <div className="rounded-r-md border-l-4 border-info bg-info-soft px-3 py-2">{content}</div>
  ) : (
    <p>{content}</p>
  );
}

export function wrapSelection(
  value: string,
  start: number,
  end: number,
  kind: "bold" | "italic" | "link" | "callout",
  placeholder: string,
): { value: string; start: number; end: number } {
  const selected = value.slice(start, end) || placeholder;
  if (kind === "callout") {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end);
    const stop = lineEnd < 0 ? value.length : lineEnd;
    const block = value
      .slice(lineStart, stop)
      .split("\n")
      .map((line) => (line.startsWith(">") ? line.replace(/^>\s?/, "") : `> ${line}`))
      .join("\n");
    const next = value.slice(0, lineStart) + block + value.slice(stop);
    return { value: next, start: lineStart, end: lineStart + block.length };
  }
  const [before, after] =
    kind === "bold" ? ["**", "**"] : kind === "italic" ? ["*", "*"] : ["[", "](https://)"];
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  const from = start + before.length;
  return { value: next, start: from, end: from + selected.length };
}

export function IntroductionEditor({
  value,
  disabled,
  onChange,
  onCommit,
  status,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  status: ReactNode;
}) {
  const { t } = useTranslation();
  const area = useRef<HTMLTextAreaElement>(null);
  const apply = (kind: "bold" | "italic" | "link" | "callout") => {
    const element = area.current;
    if (!element) return;
    const result = wrapSelection(
      value,
      element.selectionStart,
      element.selectionEnd,
      kind,
      t("knowledgeBase.folders.introPlaceholderText"),
    );
    onChange(result.value);
    onCommit(result.value);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(result.start, result.end);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("knowledgeBase.categories.intro")} hint={t("knowledgeBase.folders.introHint")}>
        <div className="flex flex-col gap-1">
          {disabled ? null : (
            <div
              role="toolbar"
              aria-label={t("knowledgeBase.folders.format")}
              className="flex flex-wrap gap-1"
            >
              <IconButton
                label={t("knowledgeBase.folders.bold")}
                icon={Bold}
                size="sm"
                onClick={() => apply("bold")}
              />
              <IconButton
                label={t("knowledgeBase.folders.italic")}
                icon={Italic}
                size="sm"
                onClick={() => apply("italic")}
              />
              <IconButton
                label={t("knowledgeBase.folders.link")}
                icon={Link}
                size="sm"
                onClick={() => apply("link")}
              />
              <IconButton
                label={t("knowledgeBase.folders.callout")}
                icon={Info}
                size="sm"
                onClick={() => apply("callout")}
              />
            </div>
          )}
          <Textarea
            ref={area}
            rows={4}
            maxLength={INTRODUCTION_MAX_LENGTH}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onBlur={(event) => onCommit(event.target.value)}
          />
        </div>
      </Field>
      {status}
      {value.trim() ? (
        <section
          aria-label={t("knowledgeBase.folders.preview")}
          className="rounded-md border border-border p-3"
        >
          <h4 className="mb-2 text-xs font-semibold tracking-label text-text-muted uppercase">
            {t("knowledgeBase.folders.preview")}
          </h4>
          <IntroductionPreview source={value} />
        </section>
      ) : null}
    </div>
  );
}
