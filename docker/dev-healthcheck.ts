// Healthcheck of the development container: web, api, collab and worker must answer.
const endpoints = {
  web: "http://localhost:5173/",
  api: "http://localhost:3000/health/ready",
  collab: "http://localhost:3001/health/ready",
  worker: "http://localhost:3002/health/ready",
};

const results = await Promise.all(
  Object.entries(endpoints).map(async ([name, url]) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return [name, response.ok] as const;
    } catch {
      return [name, false] as const;
    }
  }),
);

const failed = results.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length > 0) {
  console.error(`Not healthy: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("web, api, collab and worker are healthy");
