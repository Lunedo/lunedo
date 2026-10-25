import { Check, CircleAlert, Copy, ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, IconButton } from "./button.js";
import { Notice } from "./feedback.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export const SAVED_VISIBLE_MS = 2500;
export const COPIED_VISIBLE_MS = 2000;

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface SaveStatusProps {
  state: SaveState;
  error?: ReactNode;
  onRetry?: () => void;
  hideSavedAfter?: number | null;
}

export function SaveStatus({ state, error, onRetry, hideSavedAfter = SAVED_VISIBLE_MS }: SaveStatusProps) {
  const labels = useUiLabels();
  const [savedVisible, setSavedVisible] = useState(false);

  useEffect(() => {
    if (state !== "saved") {
      setSavedVisible(false);
      return;
    }
    setSavedVisible(true);
    if (hideSavedAfter === null) return;
    const timer = setTimeout(() => setSavedVisible(false), hideSavedAfter);
    return () => clearTimeout(timer);
  }, [state, hideSavedAfter]);

  return (
    <span className="inline-flex min-h-control-sm flex-wrap items-center gap-2 text-sm">
      <span role="status" className="inline-flex items-center gap-1 text-text-muted">
        {state === "saving" && (
          <>
            <Icon icon={LoaderCircle} size="sm" className="animate-spin motion-reduce:animate-none" />
            <span>{labels.saving}</span>
          </>
        )}
        {state === "saved" && savedVisible && (
          <>
            <Icon icon={Check} size="sm" className="text-success" />
            <span>{labels.saved}</span>
          </>
        )}
      </span>
      {state === "error" && (
        <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-danger">
          <Icon icon={CircleAlert} size="sm" />
          <span>{error}</span>
          {onRetry && (
            <Button variant="outline" size="sm" icon={RotateCcw} onClick={onRetry}>
              {labels.retry}
            </Button>
          )}
        </span>
      )}
    </span>
  );
}

export interface CopyButtonProps {
  value: string;
  label?: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const labels = useUiLabels();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_VISIBLE_MS);
  };

  return (
    <span className="inline-flex items-center">
      <IconButton
        label={label ?? labels.copy}
        icon={copied ? Check : Copy}
        variant="ghost"
        size="sm"
        onClick={() => {
          void copy();
        }}
      />
      <span role="status" className="sr-only">
        {copied ? labels.copied : ""}
      </span>
    </span>
  );
}

export interface CodeBlockProps {
  value: string;
  copyLabel?: string;
  label?: string;
  children?: ReactNode;
}

export function CodeBlock({ value, copyLabel, label, children }: CodeBlockProps) {
  return (
    <figure
      className="relative min-w-0 rounded-md border border-border bg-surface-sunken"
      {...(label ? { "aria-label": label } : {})}
    >
      <pre className="min-w-0 whitespace-pre-wrap break-all py-2 pr-control-lg pl-3 font-mono text-sm">
        {children ?? value}
      </pre>
      <span className="absolute top-0 right-0 p-1">
        <CopyButton value={value} {...(copyLabel ? { label: copyLabel } : {})} />
      </span>
    </figure>
  );
}

export interface ErrorStateProps {
  title: ReactNode;
  cause?: ReactNode;
  action?: ReactNode;
  details?: ReactNode;
  command?: string;
  documentationUrl?: string;
  documentationLabel?: string;
  onRetry?: () => void;
  retryLabel?: string;
  variant?: "danger" | "warning";
}

export function ErrorState({
  title,
  cause,
  action,
  details,
  command,
  documentationUrl,
  documentationLabel,
  onRetry,
  retryLabel,
  variant = "danger",
}: ErrorStateProps) {
  const labels = useUiLabels();
  return (
    <Notice
      variant={variant}
      title={title}
      action={
        onRetry && (
          <Button variant="outline" size="sm" icon={RotateCcw} onClick={onRetry}>
            {retryLabel ?? labels.retry}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-2">
        {cause && <p>{cause}</p>}
        {action && <p>{action}</p>}
        {details && <p className="font-mono text-sm text-text-muted">{details}</p>}
        {command && <CodeBlock value={command} />}
        {documentationUrl && (
          <a
            href={documentationUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 rounded-sm text-accent underline-offset-2 hover:underline focus-visible:focus-ring"
          >
            {documentationLabel ?? labels.documentation}
            <Icon icon={ExternalLink} size="sm" />
          </a>
        )}
      </div>
    </Notice>
  );
}
