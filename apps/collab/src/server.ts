import { Server } from "@hocuspocus/server";
import { handleOperationsRequest, type OperationsEndpoints } from "@pagehall/server";

export class CollabAuthenticationError extends Error {
  override name = "CollabAuthenticationError";
}

/**
 * Creates the collaboration server. Every connection is rejected until documents
 * and sessions exist; authentication then checks the session and page access.
 */
export function createCollabServer(options: {
  host: string;
  port: number;
  endpoints: OperationsEndpoints;
}): Server {
  const { endpoints } = options;
  const logger = endpoints.logger;
  return new Server({
    name: "pagehall-collab",
    port: options.port,
    address: options.host,
    quiet: true,
    stopOnSignals: false,
    async onRequest({ request, response }) {
      const handled = await handleOperationsRequest(request, response, endpoints);
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
