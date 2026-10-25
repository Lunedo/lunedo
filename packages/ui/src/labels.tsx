import { Tooltip as TooltipPrimitive } from "radix-ui";
import { createContext, type ReactNode, useContext } from "react";

export interface UiLabels {
  close: string;
  sortAscending: string;
  sortDescending: string;
  notSorted: string;
  previousPage: string;
  nextPage: string;
  page: string;
  loading: string;
  dismiss: string;
  showPassword: string;
  hidePassword: string;
  clear: string;
  required: string;
  optional: string;
  breadcrumbs: string;
  notifications: string;
  decrease: string;
  increase: string;
  resetToDefault: string;
  saving: string;
  saved: string;
  retry: string;
  copy: string;
  copied: string;
  documentation: string;
  durationUnit: string;
  minutes: string;
  hours: string;
  days: string;
  defaultMarker: string;
  custom: string;
  apply: string;
  cancel: string;
  durationRange: string;
  noMatches: string;
  loadMore: string;
  removeItem: string;
  search: string;
  resetFilters: string;
  suggested: string;
  allTimeZones: string;
  browserTimeZone: string;
  undo: string;
  secondsLeft: string;
  previousMonth: string;
  nextMonth: string;
  today: string;
  chooseDate: string;
  rowsPerPage: string;
  previous: string;
  next: string;
  selectAll: string;
  selection: string;
}

const LabelsContext = createContext<UiLabels | null>(null);

export function UiProvider({ labels, children }: { labels: UiLabels; children: ReactNode }) {
  return (
    <LabelsContext.Provider value={labels}>
      <TooltipPrimitive.Provider delayDuration={400}>{children}</TooltipPrimitive.Provider>
    </LabelsContext.Provider>
  );
}

export function useUiLabels(): UiLabels {
  const labels = useContext(LabelsContext);
  if (!labels) throw new Error("UiProvider is missing");
  return labels;
}
