import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function HomeRow({
  to,
  leading,
  title,
  meta,
  metaClassName,
}: {
  to: string;
  leading: ReactNode;
  title: string;
  meta?: ReactNode;
  metaClassName?: string;
}) {
  return (
    <Link
      to={to as never}
      className="flex min-h-hit items-center gap-3 rounded-sm px-2 py-2 text-text hover:bg-hover focus-visible:focus-ring"
    >
      <span className="flex w-6 shrink-0 justify-center text-text-muted">{leading}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={title}>
          {title}
        </span>
        {meta ? (
          <span className={`truncate text-sm ${metaClassName ?? "text-text-muted"}`}>{meta}</span>
        ) : null}
      </span>
    </Link>
  );
}

export function HomeEmpty({ text }: { text: string }) {
  return <p className="px-2 py-3 text-sm text-text-muted">{text}</p>;
}
