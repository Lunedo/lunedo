import type { ReactNode } from "react";
import { Popover } from "./overlays.js";
import { TruncatedText } from "./truncated-text.js";

export interface ListedValue {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface FirstAndMoreProps {
  values: readonly ListedValue[];
  title: string;
  moreLabel: (count: number) => string;
  empty?: ReactNode;
}

export function FirstAndMore({ values, title, moreLabel, empty = null }: FirstAndMoreProps) {
  const [first, ...rest] = values;
  if (!first) return <>{empty}</>;
  return (
    <span data-first-and-more="" className="flex min-w-0 items-center gap-1 whitespace-nowrap">
      {first.icon ? <span className="flex shrink-0">{first.icon}</span> : null}
      <TruncatedText text={first.label} />
      {rest.length > 0 ? (
        <Popover
          label={title}
          align="start"
          trigger={
            <button
              type="button"
              aria-label={moreLabel(rest.length)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="shrink-0 rounded-sm px-1 text-sm font-medium text-accent hover:underline focus-visible:focus-ring"
            >
              +{rest.length}
            </button>
          }
        >
          <div className="flex max-w-card flex-col gap-2 p-3">
            <p className="text-sm font-semibold">{title}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {values.map((value) => (
                <li key={value.id} className="flex min-w-0 items-center gap-2">
                  {value.icon ? <span className="flex shrink-0">{value.icon}</span> : null}
                  <TruncatedText text={value.label} />
                </li>
              ))}
            </ul>
          </div>
        </Popover>
      ) : null}
    </span>
  );
}
