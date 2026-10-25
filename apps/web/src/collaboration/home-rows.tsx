import { Skeleton } from "@lunedo/ui";
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

const ROW_WIDTHS = ["w-2/3", "w-1/2", "w-3/4"] as const;

export function HomeRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <span aria-hidden="true" className="flex flex-col">
      {ROW_WIDTHS.slice(0, rows).map((width) => (
        <span key={width} className="flex min-h-hit items-center gap-3 px-2 py-2">
          <Skeleton className="size-icon-md shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <Skeleton className={width} />
            <Skeleton className="h-3 w-1/3" />
          </span>
        </span>
      ))}
    </span>
  );
}
