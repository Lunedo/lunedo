export function testRedisUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.LUNEDO_TEST_REDIS_URL?.trim();
  if (!url && env.CI) throw new Error("LUNEDO_TEST_REDIS_URL must be set in CI");
  return url || undefined;
}
