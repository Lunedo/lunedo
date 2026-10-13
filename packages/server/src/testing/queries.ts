import type { DatabasePool } from "../database/pool.js";

export interface QueryCount {
  readonly count: number;
  stop(): number;
}

export function countQueries(
  pool: DatabasePool,
  matches: (text: string) => boolean = () => true,
): QueryCount {
  const query = pool.query;
  let count = 0;
  pool.query = function (this: DatabasePool, ...args: unknown[]) {
    const [first] = args;
    const text = typeof first === "string" ? first : ((first as { text?: string } | undefined)?.text ?? "");
    if (matches(text)) count += 1;
    return Reflect.apply(query, this, args);
  } as DatabasePool["query"];
  return {
    get count() {
      return count;
    },
    stop() {
      pool.query = query;
      return count;
    },
  };
}
