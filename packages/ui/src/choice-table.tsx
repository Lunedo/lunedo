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
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-sunken">
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
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border last:border-b-0">
              <th scope="row" className="px-4 py-2 text-left align-middle font-normal">
                <span className="flex flex-col gap-1">
                  <span className="font-medium text-text">{row.label}</span>
                  {row.description ? (
                    <span className="text-sm text-text-muted">{row.description}</span>
                  ) : null}
                </span>
              </th>
              <td className="w-0 px-4 py-2 text-right align-middle whitespace-nowrap">
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
