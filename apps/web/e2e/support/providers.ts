import { type APIRequestContext, expect } from "@playwright/test";
import pg from "pg";
import { readState } from "./environment.js";

export async function deleteProvider(
  request: APIRequestContext,
  headers: Record<string, string>,
  providerId: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: readState().databaseUrl });
  await client.connect();
  let linked: { id: string; account_id: string }[];
  try {
    linked = (
      await client.query<{ id: string; account_id: string }>(
        "select id, account_id from identities where provider_id = $1",
        [providerId],
      )
    ).rows;
  } finally {
    await client.end();
  }
  for (const identity of linked) {
    const unlinked = await request.delete(
      `/api/v1/accounts/${identity.account_id}/identities/${identity.id}`,
      {
        headers,
      },
    );
    expect(unlinked.status(), await unlinked.text()).toBeLessThan(300);
  }
  const removed = await request.delete(`/api/v1/instance/identity-providers/${providerId}`, { headers });
  expect(removed.status(), await removed.text()).toBeLessThan(300);
}
