import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useRef, useState } from "react";
import { Button, IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { Field, FieldLayoutProvider, Input } from "./field.js";
import { focusInitial } from "./initial-focus.js";
import { useUiLabels } from "./labels.js";
import { useReturnFocus } from "./return-focus.js";

export type DialogSize = "sm" | "md" | "lg" | "full";

const SIZES: Record<DialogSize, string> = {
  sm: "max-w-dialog-sm",
  md: "max-w-dialog-md",
  lg: "max-w-dialog-lg",
  full: "h-full max-w-none",
};

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  footer?: ReactNode;
  children?: ReactNode;
  dismissible?: boolean;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  footer,
  children,
  dismissible = true,
}: DialogProps) {
  const labels = useUiLabels();
  const returnFocus = useReturnFocus(open);
  const content = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-overlay p-4">
          <DialogPrimitive.Content
            ref={content}
            onOpenAutoFocus={(event) => focusInitial(event, content, header)}
            onCloseAutoFocus={returnFocus}
            {...(dismissible
              ? {}
              : {
                  onEscapeKeyDown: (event: Event) => event.preventDefault(),
                  onInteractOutside: (event: Event) => event.preventDefault(),
                })}
            {...(description ? {} : { "aria-describedby": undefined })}
            className={classNames(
              "flex w-full min-w-0 flex-col gap-4 rounded-lg bg-surface p-5 text-text shadow-dialog focus-visible:focus-ring",
              SIZES[size],
            )}
          >
            <div ref={header} className="flex items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <DialogPrimitive.Title className="text-content font-semibold tracking-heading">
                  {title}
                </DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="text-text-muted">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close asChild>
                <IconButton label={labels.close} icon={X} tooltip={false} />
              </DialogPrimitive.Close>
            </div>
            <FieldLayoutProvider layout="stacked">{children}</FieldLayoutProvider>
            {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  typedConfirmation?: TypedConfirmation;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}

export interface TypedConfirmation {
  value: string;
  label: ReactNode;
  mismatch: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  typedConfirmation,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const typedRef = useRef<HTMLInputElement>(null);
  const confirm = async () => {
    if (typedConfirmation && typed.trim() !== typedConfirmation.value.trim()) {
      setMismatch(true);
      typedRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      return;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) {
          setTyped("");
          setMismatch(false);
        }
        onOpenChange(next);
      }}
      title={title}
      {...(description !== undefined ? { description } : {})}
      size="sm"
      footer={
        <div
          className={classNames(
            "flex w-full flex-wrap gap-2",
            destructive ? "justify-between" : "justify-end",
          )}
        >
          {destructive ? null : (
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
          )}
          <Button
            {...(destructive || typedConfirmation ? {} : { "data-autofocus": "" })}
            variant={destructive ? "dangerPrimary" : "primary"}
            loading={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
          {destructive ? (
            <Button
              {...(typedConfirmation ? {} : { "data-autofocus": "" })}
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
          ) : null}
        </div>
      }
    >
      {children}
      {typedConfirmation ? (
        <Field label={typedConfirmation.label} {...(mismatch ? { error: typedConfirmation.mismatch } : {})}>
          <Input
            ref={typedRef}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setTyped(event.target.value);
              if (mismatch && event.target.value.trim() === typedConfirmation.value.trim())
                setMismatch(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void confirm();
            }}
          />
        </Field>
      ) : null}
    </Dialog>
  );
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  side?: "left" | "right" | "bottom";
  size?: "sidebar" | "panel";
  children?: ReactNode;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  side = "left",
  size = "sidebar",
  children,
}: DrawerProps) {
  const labels = useUiLabels();
  const returnFocus = useReturnFocus(open);
  const content = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <DialogPrimitive.Content
          ref={content}
          onOpenAutoFocus={(event) => focusInitial(event, content, header)}
          onCloseAutoFocus={returnFocus}
          aria-describedby={undefined}
          {...(side === "bottom" ? { style: { maxHeight: "80dvh" } } : {})}
          className={classNames(
            "fixed z-50 flex max-w-full flex-col text-text shadow-dialog focus-visible:focus-ring",
            side === "bottom"
              ? "inset-x-0 bottom-0 rounded-t-lg border-t border-border bg-surface"
              : classNames(
                  "inset-y-0 bg-sidebar",
                  size === "panel" ? "w-panel" : "w-sidebar",
                  side === "left" ? "left-0 border-r border-border" : "right-0 border-l border-border",
                ),
          )}
        >
          <div ref={header} className="flex items-center gap-2 border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="flex-1 font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton label={labels.close} icon={X} tooltip={false} />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FieldLayoutProvider layout="stacked">{children}</FieldLayoutProvider>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
