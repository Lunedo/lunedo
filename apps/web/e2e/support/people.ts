import { type Browser, type BrowserContext, expect } from "@playwright/test";
import { BASE_URL } from "./environment.js";
import { freshTotp, linkFrom, waitForMail } from "./helpers.js";

export type ContextFactory = Pick<Browser, "newContext">;

export interface Person {
  id: string;
  name: string;
  email: string;
  password: string;
}

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const HEADERS = { "X-Lunedo-Request": "1", origin: BASE_URL };
let clientAddress: string | undefined;

export function sendAs(address: string | undefined): void {
  clientAddress = address;
}
export const SIGNED_OUT: StorageState = { cookies: [], origins: [] };

export function unique(): string {
  const random = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${Date.now().toString(36).slice(-5)}${random}`.toUpperCase();
}

export async function forwardFrom(context: BrowserContext): Promise<BrowserContext> {
  const address = clientAddress;
  if (address) {
    await context.route(`${BASE_URL}/**`, (route) =>
      route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }),
    );
  }
  return context;
}

export async function post(context: BrowserContext, path: string, data: unknown): Promise<unknown> {
  const response = await context.request.post(new URL(path, BASE_URL).toString(), {
    data,
    headers: clientAddress ? { ...HEADERS, "X-Forwarded-For": clientAddress } : HEADERS,
  });
  expect(response.status(), `POST ${path}: ${await response.text()}`).toBeLessThan(300);
  return response.status() === 204 ? null : ((await response.json()) as unknown);
}

export async function join(
  inviter: BrowserContext,
  browser: ContextFactory,
  organizationId: string,
  first: string,
  role?: { builtIn: "owner" },
): Promise<Person> {
  const name = `${first} ${unique()}`;
  const email = `${name.toLowerCase().split(" ").join(".")}@lunedo.test`;
  const password = `${first} passphrase for testing`;
  await post(inviter, `/api/v1/organizations/${organizationId}/invitations`, {
    email,
    kind: "member",
    ...(role ? { role } : {}),
  });
  const token = /#token=([\w-]+)/.exec(linkFrom((await waitForMail(email, /invit/i)).text))?.[1] ?? "";
  const anonymous = await browser.newContext({ storageState: SIGNED_OUT });
  try {
    const { accountId } = (await post(anonymous, "/api/v1/invitations/accept", {
      token,
      name,
      password,
    })) as { accountId: string };
    return { id: accountId, name, email, password };
  } finally {
    await anonymous.close();
  }
}

export async function sessionOf(browser: ContextFactory, person: Person): Promise<StorageState> {
  const context = await browser.newContext({ storageState: SIGNED_OUT });
  try {
    await post(context, "/api/v1/auth/sign-in", { email: person.email, password: person.password });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

export async function addAuthenticator(
  browser: ContextFactory,
  state: StorageState,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const context = await browser.newContext({ storageState: state });
  try {
    const { secret } = (await post(context, "/api/v1/account/totp", {})) as { secret: string };
    const { recoveryCodes } = (await post(context, "/api/v1/account/totp/confirm", {
      code: await freshTotp(secret),
    })) as { recoveryCodes: string[] | null };
    return { secret, recoveryCodes: recoveryCodes ?? [] };
  } finally {
    await context.close();
  }
}
