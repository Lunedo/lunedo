import { createDatabase, createDatabasePool, PostgresSearchAdapter, SearchIndexer } from "@pagehall/server";

async function withIndexer<T>(databaseUrl: string, use: (indexer: SearchIndexer) => Promise<T>): Promise<T> {
  const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-cli" });
  try {
    return await use(
      new SearchIndexer({ database: createDatabase(pool), adapter: new PostgresSearchAdapter() }),
    );
  } finally {
    await pool.end();
  }
}

export async function rebuildSearchIndex(databaseUrl: string, write: (line: string) => void): Promise<void> {
  const queued = await withIndexer(databaseUrl, (indexer) => indexer.requestRebuild());
  write(`Rebuilding the search index: ${queued} pages and blog posts are queued for the worker.`);
  write("Search keeps answering meanwhile and tells people that results may be incomplete.");
  write('Run "pagehall search status" to follow the progress.');
}

export async function searchIndexStatus(databaseUrl: string, write: (line: string) => void): Promise<void> {
  const state = await withIndexer(databaseUrl, (indexer) => indexer.state());
  if (state.building) write(`The search index is being built: ${state.done} of ${state.total} pages done.`);
  else write("The search index is complete.");
  write(`Pages waiting for an update: ${state.pendingItems}.`);
}
