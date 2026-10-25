import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useUiLabels } from "./labels.js";
import { useReturnFocus } from "./return-focus.js";
import { Tooltip } from "./tooltip.js";

export interface LightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actions?: ReactNode;
  footer?: ReactNode;
  previousLabel?: string;
  nextLabel?: string;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  aside?: ReactNode;
  children: ReactNode;
}

export const LIGHTBOX_BUTTON =
  "inline-flex size-control-lg items-center justify-center rounded-md text-on-lightbox hover:bg-on-lightbox/15 focus-visible:focus-ring";

export function LightboxButton({
  label,
  icon,
  onClick,
  href,
  download,
  pressed,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  href?: string;
  download?: string;
  pressed?: boolean;
}) {
  const content = href ? (
    <a
      href={href}
      aria-label={label}
      className={LIGHTBOX_BUTTON}
      {...(download !== undefined ? { download } : { target: "_blank", rel: "noopener noreferrer" })}
    >
      {icon}
    </a>
  ) : (
    <button
      type="button"
      aria-label={label}
      className={LIGHTBOX_BUTTON}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  return <Tooltip content={label}>{content}</Tooltip>;
}

export function Lightbox({
  open,
  onOpenChange,
  title,
  actions,
  footer,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  aside,
  children,
}: LightboxProps) {
  const labels = useUiLabels();
  const returnFocus = useReturnFocus(open);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (event.key === "ArrowLeft" && onPrevious) {
      event.preventDefault();
      onPrevious();
    }
    if (event.key === "ArrowRight" && onNext) {
      event.preventDefault();
      onNext();
    }
  };
  const closeOnBackground = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onOpenChange(false);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-lightbox" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col text-on-lightbox focus-visible:outline-none"
        >
          <div className="flex min-h-toolbar items-center gap-2 px-4">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate font-medium" title={title}>
              {title}
            </DialogPrimitive.Title>
            {actions}
            <DialogPrimitive.Close asChild>
              <button type="button" aria-label={labels.close} className={LIGHTBOX_BUTTON}>
                <X aria-hidden="true" className="size-icon-lg" />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: a click on the background is a pointer shortcut; Escape and the close button close it by keyboard */}
            <div
              role="presentation"
              className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto px-4 py-2 sm:px-12"
              onClick={closeOnBackground}
            >
              {children}
              {onPrevious && previousLabel ? (
                <span className="absolute top-1/2 left-2 -translate-y-1/2">
                  <LightboxButton
                    label={previousLabel}
                    icon={<ChevronLeft aria-hidden="true" className="size-icon-lg" />}
                    onClick={onPrevious}
                  />
                </span>
              ) : null}
              {onNext && nextLabel ? (
                <span className="absolute top-1/2 right-2 -translate-y-1/2">
                  <LightboxButton
                    label={nextLabel}
                    icon={<ChevronRight aria-hidden="true" className="size-icon-lg" />}
                    onClick={onNext}
                  />
                </span>
              ) : null}
            </div>
            {aside}
          </div>
          {footer ? <div className="px-4 py-2 text-center text-sm text-on-lightbox/70">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
