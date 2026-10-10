import type { Page } from "@playwright/test";
import type { Organization } from "./fixtures.js";
import { callApi } from "./helpers.js";
import { type Person, unique } from "./people.js";

export interface Series {
  id: string;
  title: string;
  upcoming: { id: string; title: string };
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .join("-");
}

export async function teamSpace(page: Page, organization: Organization, members: Person[]) {
  await page.goto("/spaces");
  const key = `M${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Meetings ${key}`,
    key,
    visibility: "private",
    grants: members.map((member) => ({ principalKind: "account", principalId: member.id, role: "editor" })),
  })) as { id: string; key: string };
  return space;
}

export async function series(page: Page, spaceId: string, body: Record<string, unknown>): Promise<Series> {
  return (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/meeting-series`, {
    templateId: "builtin:team-meeting",
    startTime: "09:30",
    timeZone: "Europe/Vienna",
    durationMinutes: 45,
    ...body,
  })) as Series;
}
