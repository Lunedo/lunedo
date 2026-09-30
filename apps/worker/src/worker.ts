import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type DatabasePool,
  handleHealthRequest,
  type Logger,
  pingDatabase,
  type ServiceConfig,
} from "@pagehall/shared/node";

export interface Worker {
  start(): Promise<AddressInfo>;
  stop(): Promise<void>;
}

/** The background job process. It exposes health endpoints for orchestration. */
export function createWorker(options: {
  config: ServiceConfig;
  logger: Logger;
  pool: Pick<DatabasePool, "query">;
}): Worker {
  const { config, logger, pool } = options;
  const server = createServer((request, response) => {
    handleHealthRequest(request, response, {
      ready: { database: () => pingDatabase(pool as DatabasePool) },
      logger,
    }).then(
      (handled) => {
        if (!handled) response.writeHead(404).end();
      },
      (error: unknown) => {
        logger.error({ err: error }, "Health request failed");
        response.writeHead(500).end();
      },
    );
  });

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolve(server.address() as AddressInfo));
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
