import { CircleAlert, CircleCheck, X } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { classNames } from "./class-names.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export type ToastVariant = "default" | "success" | "error";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS = 5000;

export function ToastProvider({ children, label }: { children: ReactNode; label?: string }) {
  const labels = useUiLabels();
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const next = useRef(0);
  const toast = useCallback((options: ToastOptions) => {
    next.current += 1;
    const id = next.current;
    setEntries((current) => [...current, { ...options, id }]);
  }, []);
  const remove = (id: number) => setEntries((current) => current.filter((entry) => entry.id !== id));
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider duration={DURATION_MS} label={label ?? labels.notifications}>
        {children}
        {entries.map((entry) => (
          <ToastPrimitive.Root
            key={entry.id}
            {...(entry.variant === "error"
              ? { type: "foreground" as const }
              : { type: "background" as const })}
            onOpenChange={(open) => {
              if (!open) remove(entry.id);
            }}
            className={classNames(
              "flex items-start gap-3 rounded-md bg-text px-4 py-3 text-bg shadow-popover",
            )}
          >
            {entry.variant === "success" && <Icon icon={CircleCheck} className="mt-1" />}
            {entry.variant === "error" && <Icon icon={CircleAlert} className="mt-1" />}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <ToastPrimitive.Title className="font-medium">{entry.title}</ToastPrimitive.Title>
              {entry.description && (
                <ToastPrimitive.Description className="text-sm opacity-90">
                  {entry.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label={labels.dismiss}
              className="rounded-sm p-1 hover:opacity-80 focus-visible:focus-ring"
            >
              <Icon icon={X} size="sm" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          label={label ?? labels.notifications}
          className="fixed bottom-4 left-1/2 z-50 flex w-full max-w-card -translate-x-1/2 flex-col gap-2 px-4 outline-none"
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("ToastProvider is missing");
  return context;
}
