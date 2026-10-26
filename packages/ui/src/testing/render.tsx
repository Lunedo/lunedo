import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { UiLabels } from "../labels.js";
import { UiProvider } from "../labels.js";
import { ToastProvider } from "../toast.js";

export const testLabels: UiLabels = {
  close: "Close",
  sortAscending: "Sort ascending",
  sortDescending: "Sort descending",
  notSorted: "Not sorted",
  previousPage: "Previous page",
  nextPage: "Next page",
  page: "Pages",
  loading: "Loading",
  dismiss: "Dismiss",
  showPassword: "Show password",
  hidePassword: "Hide password",
  clear: "Clear",
  required: "Required",
  optional: "Optional",
  breadcrumbs: "Breadcrumbs",
  notifications: "Notifications",
  decrease: "Decrease",
  increase: "Increase",
  resetToDefault: "Default",
  saving: "Saving",
  saved: "Saved",
  retry: "Try again",
  copy: "Copy",
  copied: "Copied",
  documentation: "Read the documentation",
  durationUnit: "Unit",
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
  defaultMarker: "Default",
  custom: "Custom…",
  apply: "Apply",
  cancel: "Cancel",
  durationRange: "Choose a duration from {minimum} to {maximum}.",
  noMatches: "No matches",
  loadMore: "Load more",
  removeItem: "Remove {item}",
  search: "Search",
  resetFilters: "Reset filters",
  suggested: "Suggested",
  allTimeZones: "All time zones",
  browserTimeZone: "This browser",
  undo: "Undo",
  secondsLeft: "{seconds} s",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  today: "Today",
  chooseDate: "Choose a date",
  rowsPerPage: "Rows per page",
  previous: "Previous",
  next: "Next",
  selectAll: "Select all on this page",
  selection: "Selection",
  moreAbout: "More about",
};

export function renderUi(element: ReactElement): RenderResult {
  return render(
    <UiProvider labels={testLabels}>
      <ToastProvider>{element}</ToastProvider>
    </UiProvider>,
  );
}
