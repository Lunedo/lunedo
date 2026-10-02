import { ToastProvider, TooltipProvider, type UiLabels, UiProvider } from "@pagehall/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { i18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";
import { initI18n } from "../i18n/index.js";

const labels: UiLabels = {
  close: "Close",
  sortAscending: "Sorted ascending",
  sortDescending: "Sorted descending",
  notSorted: "Not sorted",
  previousPage: "Previous page",
  nextPage: "Next page",
  loading: "Loading",
  dismiss: "Dismiss",
  showPassword: "Show password",
  hidePassword: "Hide password",
  clear: "Clear",
  required: "required",
  optional: "optional",
  page: "Page",
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
};

export async function renderWithProviders(
  ui: ReactNode,
  language = "en",
): Promise<{ queryClient: QueryClient; i18n: i18n }> {
  const instance: i18n = await initI18n([language]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <I18nextProvider i18n={instance}>
      <QueryClientProvider client={queryClient}>
        <UiProvider labels={labels}>
          <TooltipProvider>
            <ToastProvider>{ui}</ToastProvider>
          </TooltipProvider>
        </UiProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { queryClient, i18n: instance };
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

export function mockApi(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    const text = input.method === "GET" ? "" : await input.text();
    const recorded: RecordedRequest = {
      method: input.method,
      path: url.pathname + url.search,
      body: text ? JSON.parse(text) : undefined,
      headers: input.headers,
    };
    requests.push(recorded);
    const handler = routes[`${input.method} ${url.pathname}`];
    if (!handler) {
      return new Response(
        JSON.stringify({
          type: "urn:pagehall:problem:notFound",
          title: "Not found",
          status: 404,
          code: "notFound",
        }),
        { status: 404, headers: { "content-type": "application/problem+json" } },
      );
    }
    const { status = 200, body } = handler(recorded);
    if (status === 204) return new Response(null, { status });
    const problem = status >= 400;
    return new Response(JSON.stringify(body ?? {}), {
      status,
      headers: { "content-type": problem ? "application/problem+json" : "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { requests, fetch };
}

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return { status, body: { type: `urn:pagehall:problem:${code}`, title: code, status, code, ...extra } };
}
