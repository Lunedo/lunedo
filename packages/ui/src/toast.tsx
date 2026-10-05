import { CircleAlert, CircleCheck, Info, TriangleAlert, Undo2, X } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export type ToastVariant = "default" | "success" | "warning" | "error";

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  action?: { label: string; onSelect: () => void };
  undo?: { onUndo: () => void; seconds?: number };
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const UNDO_SECONDS = 10;

const DURATION_MS: Record<ToastVariant, number> = {
  default: 4000,
  success: 4000,
  warning: 7000,
  error: Number.POSITIVE_INFINITY,
};

const ICONS = { default: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

function durationOf(entry: ToastOptions): number {
  if (entry.undo) return (entry.undo.seconds ?? UNDO_SECONDS) * 1000;
  return DURATION_MS[entry.variant ?? "default"];
}

function Countdown({ seconds, paused }: { seconds: number; paused: boolean }) {
  const labels = useUiLabels();
  const [left, setLeft] = useState(seconds);
  const remaining = useRef(seconds * 1000);
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const base = remaining.current;
    const elapsed = () => base - (Date.now() - startedAt);
    const timer = setInterval(() => setLeft(Math.max(0, Math.ceil(elapsed() / 1000))), 250);
    return () => {
      remaining.current = elapsed();
      clearInterval(timer);
    };
  }, [paused]);
  return (
    <span data-countdown="" className="text-sm tabular-nums">
      {labels.secondsLeft.replace("{seconds}", String(left))}
    </span>
  );
}

function ToastItem({ entry, onClosed }: { entry: ToastEntry; onClosed: () => void }) {
  const labels = useUiLabels();
  const [paused, setPaused] = useState(false);
  const variant = entry.variant ?? "default";
  return (
    <ToastPrimitive.Root
      type={variant === "error" ? "foreground" : "background"}
      duration={durationOf(entry)}
      data-variant={variant}
      onPause={() => setPaused(true)}
      onResume={() => setPaused(false)}
      onOpenChange={(open) => {
        if (!open) onClosed();
      }}
      className="flex items-start gap-3 rounded-md bg-text px-4 py-3 text-bg shadow-popover"
    >
      <Icon icon={ICONS[variant]} className="mt-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ToastPrimitive.Title className="font-medium">{entry.title}</ToastPrimitive.Title>
        {entry.description && (
          <ToastPrimitive.Description className="text-sm">{entry.description}</ToastPrimitive.Description>
        )}
        {(entry.action || entry.undo) && (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {entry.undo && (
              <ToastPrimitive.Action altText={labels.undo} asChild>
                <button
                  type="button"
                  onClick={entry.undo.onUndo}
                  className="inline-flex min-h-hit items-center gap-1 rounded-sm border border-current px-2 text-sm font-medium hover:opacity-80 focus-visible:focus-ring"
                >
                  <Icon icon={Undo2} size="sm" />
                  {labels.undo}
                </button>
              </ToastPrimitive.Action>
            )}
            {entry.undo && <Countdown seconds={entry.undo.seconds ?? UNDO_SECONDS} paused={paused} />}
            {entry.action && (
              <ToastPrimitive.Action altText={entry.action.label} asChild>
                <button
                  type="button"
                  onClick={entry.action.onSelect}
                  className="inline-flex min-h-hit items-center rounded-sm border border-current px-2 text-sm font-medium hover:opacity-80 focus-visible:focus-ring"
                >
                  {entry.action.label}
                </button>
              </ToastPrimitive.Action>
            )}
          </div>
        )}
      </div>
      <ToastPrimitive.Close
        aria-label={labels.dismiss}
        className="relative rounded-sm p-1 after:absolute after:top-1/2 after:left-1/2 after:size-hit after:-translate-x-1/2 after:-translate-y-1/2 hover:opacity-80 focus-visible:focus-ring"
      >
        <Icon icon={X} size="sm" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

const MAX_VISIBLE = 3;

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
      <ToastPrimitive.Provider label={label ?? labels.notifications}>
        {children}
        {entries.slice(-MAX_VISIBLE).map((entry) => (
          <ToastItem key={entry.id} entry={entry} onClosed={() => remove(entry.id)} />
        ))}
        <ToastPrimitive.Viewport
          label={label ?? labels.notifications}
          className="fixed inset-x-0 top-4 z-50 mx-auto flex w-full max-w-card flex-col gap-2 px-4 outline-none sm:top-auto sm:right-4 sm:bottom-4 sm:left-auto sm:mx-0 sm:px-0"
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
