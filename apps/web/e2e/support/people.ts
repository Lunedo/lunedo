import { type Browser, expect, type Page } from "@playwright/test";
import { BASE_URL, readState } from "./environment.js";
import { callApi, linkFrom, waitForMail } from "./helpers.js";

export interface Person {
  id: string;
  name: string;
  email: string;
  password: string;
}

export function unique(): string {
  const random = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${Date.now().toString(36).slice(-5)}${random}`.toUpperCase();
}

export async function organizationId(page: Page): Promise<string> {
  const stored = readState().organizationId;
  if (stored) return stored;
  const response = await page.request.get("/api/v1/organizations?limit=10");
  return ((await response.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
}

export async function inviteMember(page: Page, browser: Browser, first: string): Promise<Person> {
  const name = `${first} ${unique()}`;
  const email = `${name.toLowerCase().split(" ").join(".")}@pagehall.test`;
  const password = `${first} passphrase for testing`;
  await callApi(page, "POST", `/api/v1/organizations/${await organizationId(page)}/invitations`, {
    email,
    kind: "member",
  });
  const token = /#token=([\w-]+)/.exec(linkFrom((await waitForMail(email, /invit/i)).text))?.[1] ?? "";
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const response = await anonymous.request.post(`${BASE_URL}/api/v1/invitations/accept`, {
      data: { token, name, password },
      headers: { "X-Pagehall-Request": "1", origin: BASE_URL },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    const { accountId } = (await response.json()) as { accountId: string };
    return { id: accountId, name, email, password };
  } finally {
    await anonymous.close();
  }
}
