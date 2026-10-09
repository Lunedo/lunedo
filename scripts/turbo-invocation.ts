import { type Host, turboPlan } from "../packages/config/src/parallelism.ts";

export interface TurboInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function turboInvocation(args: string[], env: NodeJS.ProcessEnv, host?: Host): TurboInvocation {
  const plan = turboPlan(env, host);
  if (!plan) return { args, env };
  const concurrency = args.some((arg) => arg.startsWith("--concurrency")) || env.TURBO_CONCURRENCY;
  return {
    args: concurrency ? args : [...args, `--concurrency=${plan.concurrency}`],
    env: {
      ...env,
      PAGEHALL_TEST_WORKERS: env.PAGEHALL_TEST_WORKERS ?? String(plan.workers),
      GOMAXPROCS: env.GOMAXPROCS ?? String(plan.workers),
    },
  };
}
