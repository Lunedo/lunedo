import { Server } from "@hocuspocus/server";
import {
  type DatabasePool,
  handleHealthRequest,
  type Logger,
  pingDatabase,
  type ServiceConfig,
} from "@pagehall/shared/node";

export class CollabAuthenticationError extends Error {
  override name = "CollabAuthenticationError";
}

/**
 * Creates the collaboration server. Every connection is rejected until documents
 * and sessions exist; authentication then checks the session and page access.
 */
export function createCollabServer(options: {
  config: ServiceConfig;
  logger: Logger;
  pool: Pick<DatabasePool, "query">;
}): Server {
  const { config, logger, pool } = options;
  return new Server({
    name: "pagehall-collab",
    port: config.port,
    address: config.host,
    quiet: true,
    stopOnSignals: false,
    async onRequest({ request, response }) {
      const handled = await handleHealthRequest(request, response, {
        ready: { database: () => pingDatabase(pool as DatabasePool) },
        logger,
      });
      if (!handled) response.writeHead(404).end();
      // Rejecting without a reason stops Hocuspocus from writing its own response.
      return Promise.reject();
    },
    async onAuthenticate({ documentName }) {
      logger.debug({ documentName }, "Connection rejected");
      throw new CollabAuthenticationError("Collaboration is not available");
    },
  });
}
