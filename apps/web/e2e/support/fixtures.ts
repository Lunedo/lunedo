import { type BrowserContext, test as base, expect, type Page } from "@playwright/test";
import { OWNER_STORAGE } from "./environment.js";
import { signInWithPassword } from "./helpers.js";
import {
  type ContextFactory,
  forwardFrom,
  join,
  type Person,
  post,
  SIGNED_OUT,
  type StorageState,
  sendAs,
  sessionOf,
  unique,
} from "./people.js";

export interface Organization {
  id: string;
  name: string;
  admin: Person;
  adminState: StorageState;
  invite(first: string): Promise<Person>;
  signIn(person: Person): Promise<{ context: BrowserContext; page: Page }>;
}

let clients = 0;

export const test = base.extend<{
  organization: Organization;
  instanceAdministrator: boolean;
  clientAddress: string;
}>({
  instanceAdministrator: [false, { option: true }],
  clientAddress: [
    async ({ browserName: _ }, use, testInfo) => {
      clients += 1;
      const address = `10.${testInfo.workerIndex % 256}.${Math.floor(clients / 256) % 256}.${clients % 256}`;
      sendAs(address);
      await use(address);
      sendAs(undefined);
    },
    { auto: true },
  ],
  organization: async ({ browser, baseURL, instanceAdministrator, clientAddress: _ }, use) => {
    const factory: ContextFactory = {
      newContext: (options) => browser.newContext({ baseURL, ...options }),
    };
    const contexts: BrowserContext[] = [];
    const owner = await factory.newContext({ storageState: OWNER_STORAGE });
    contexts.push(owner);
    try {
      const name = `Team ${unique()}`;
      const { id } = (await post(owner, "/api/v1/organizations", { name })) as { id: string };
      const admin = await join(owner, factory, id, "Alex", { builtIn: "owner" });
      if (instanceAdministrator) {
        await post(owner, "/api/v1/instance/role-assignments", {
          role: { builtIn: "administrator" },
          principal: { kind: "account", id: admin.id },
        });
      }
      const adminState = await sessionOf(factory, admin);
      const acting = await factory.newContext({ storageState: adminState });
      contexts.push(acting);
      await use({
        id,
        name,
        admin,
        adminState,
        invite: (first) => join(acting, factory, id, first),
        signIn: async (person) => {
          const context = await forwardFrom(await browser.newContext({ storageState: SIGNED_OUT }));
          contexts.push(context);
          const page = await context.newPage();
          await page.goto("/sign-in");
          await signInWithPassword(page, person.email, person.password);
          await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
          return { context, page };
        },
      });
    } finally {
      for (const context of contexts) await context.close();
    }
  },
  context: async ({ context, clientAddress: _ }, use) => {
    await use(await forwardFrom(context));
  },
  storageState: async ({ organization }, use) => {
    await use(organization.adminState);
  },
});

export { expect };
