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
};

export function renderUi(element: ReactElement): RenderResult {
  return render(
    <UiProvider labels={testLabels}>
      <ToastProvider>{element}</ToastProvider>
    </UiProvider>,
  );
}
