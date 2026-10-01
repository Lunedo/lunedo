import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button, IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { useUiLabels } from "./labels.js";

export type DialogSize = "sm" | "md" | "lg";

const SIZES: Record<DialogSize, string> = {
  sm: "max-w-dialog-sm",
  md: "max-w-dialog-md",
  lg: "max-w-dialog-lg",
};

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  footer,
  children,
}: DialogProps) {
  const labels = useUiLabels();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-overlay p-4">
          <DialogPrimitive.Content
            {...(description ? {} : { "aria-describedby": undefined })}
            className={classNames(
              "flex w-full flex-col gap-4 rounded-lg bg-surface p-5 text-text shadow-dialog focus-visible:focus-ring",
              SIZES[size],
            )}
          >
            <div className="flex items-start gap-3">
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
            {children}
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
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
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
        if (!busy) onOpenChange(next);
      }}
      title={title}
      {...(description !== undefined ? { description } : {})}
      size="sm"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "dangerPrimary" : "primary"}
            loading={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  side?: "left" | "right";
  children?: ReactNode;
}

export function Drawer({ open, onOpenChange, title, side = "left", children }: DrawerProps) {
  const labels = useUiLabels();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={classNames(
            "fixed inset-y-0 z-50 flex w-sidebar max-w-full flex-col bg-sidebar text-text shadow-dialog focus-visible:focus-ring",
            side === "left" ? "left-0 border-r border-border" : "right-0 border-l border-border",
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="flex-1 font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton label={labels.close} icon={X} tooltip={false} />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
