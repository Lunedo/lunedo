import cluster from "node:cluster";
import { AggregatorRegistry, type Registry } from "prom-client";

const METRICS_MESSAGE = "lunedo:clusterMetrics";
const TIMEOUT_MS = 10_000;

interface MetricsMessage {
  type: typeof METRICS_MESSAGE;
  id: number;
  text?: string;
  error?: string;
}

function isMetricsMessage(message: unknown): message is MetricsMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === METRICS_MESSAGE &&
    typeof (message as { id?: unknown }).id === "number"
  );
}

export function aggregateClusterMetrics(): void {
  const aggregator = new AggregatorRegistry();
  cluster.on("message", (worker, message: unknown) => {
    if (!isMetricsMessage(message)) return;
    aggregator.clusterMetrics().then(
      (text) => worker.send({ type: METRICS_MESSAGE, id: message.id, text }),
      (error: unknown) =>
        worker.send({
          type: METRICS_MESSAGE,
          id: message.id,
          error: error instanceof Error ? error.message : "Collecting metrics failed",
        }),
    );
  });
}

export function clusterMetricsOf(registry: Registry): (() => Promise<string>) | undefined {
  if (!cluster.isWorker || !process.send) return undefined;
  new AggregatorRegistry();
  AggregatorRegistry.setRegistries([registry]);
  const waiting = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  let next = 0;
  process.on("message", (message: unknown) => {
    if (!isMetricsMessage(message)) return;
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    if (message.text !== undefined) entry.resolve(message.text);
    else entry.reject(new Error(message.error ?? "Collecting metrics failed"));
  });
  return () =>
    new Promise<string>((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error("The other API processes did not answer in time"));
      }, TIMEOUT_MS);
      waiting.set(id, {
        resolve: (text) => {
          clearTimeout(timer);
          resolve(text);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      process.send?.({ type: METRICS_MESSAGE, id });
    });
}
