import type { ReactNode } from "react";
import { SegmentedControl, type SegmentedOption } from "./controls.js";

export interface ChoiceTableRow {
  key: string;
  label: string;
  description?: ReactNode;
  value: string;
  options: SegmentedOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export interface ChoiceTableProps {
  caption: string;
  labelHeader: string;
  choiceHeader: string;
  rows: readonly ChoiceTableRow[];
}

export function ChoiceTable({ caption, labelHeader, choiceHeader, rows }: ChoiceTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse max-sm:block">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-sunken max-sm:sr-only">
          <tr>
            <th
              scope="col"
              className="h-control-field border-b border-border px-4 text-left text-sm font-semibold text-text-muted"
            >
              {labelHeader}
            </th>
            <th
              scope="col"
              className="h-control-field border-b border-border px-4 text-right text-sm font-semibold text-text-muted"
            >
              {choiceHeader}
            </th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((row) => (
            <tr
              key={row.key}
              data-choice-row=""
              className="border-b border-border last:border-b-0 max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:py-3"
            >
              <th
                scope="row"
                className="px-4 py-2 text-left align-middle font-normal max-sm:block max-sm:py-0"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-medium text-text">{row.label}</span>
                  {row.description ? (
                    <span className="text-sm text-text-muted">{row.description}</span>
                  ) : null}
                </span>
              </th>
              <td className="w-0 px-4 py-2 text-right align-middle whitespace-nowrap max-sm:block max-sm:w-full max-sm:py-0 max-sm:text-left max-sm:whitespace-normal">
                <SegmentedControl
                  label={row.label}
                  value={row.value}
                  options={row.options}
                  onValueChange={row.onValueChange}
                  {...(row.disabled !== undefined ? { disabled: row.disabled } : {})}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
