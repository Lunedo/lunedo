import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { handleOperationsRequest, type OperationsEndpoints } from "@lunedo/server";

export interface OperationsServer {
  start(): Promise<AddressInfo>;
  stop(): Promise<void>;
}

/** HTTP server of the worker role: health endpoints and metrics for orchestration and monitoring. */
export function createOperationsServer(options: {
  host: string;
  port: number;
  endpoints: OperationsEndpoints;
}): OperationsServer {
  const { endpoints } = options;
  const server = createServer((request, response) => {
    handleOperationsRequest(request, response, endpoints).then(
      (handled) => {
        if (!handled) response.writeHead(404).end();
      },
      (error: unknown) => {
        endpoints.logger.error({ err: error }, "Operations request failed");
        response.writeHead(500).end();
      },
    );
  });

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => resolve(server.address() as AddressInfo));
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
