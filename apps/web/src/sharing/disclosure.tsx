import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function DisclosureButton({
  open,
  onToggle,
  controls,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="flex min-h-hit items-center gap-2 self-start rounded-md px-2 text-start font-medium text-accent hover:bg-hover focus-visible:focus-ring"
    >
      <ChevronRight
        aria-hidden="true"
        className={`size-icon-md shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
      />
      {children}
    </button>
  );
}
