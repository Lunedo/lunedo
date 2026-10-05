import { startFakeGoogleDirectory } from "./google-directory.js";
import { startFakeGraph } from "./microsoft-graph.js";

const graph = await startFakeGraph({ port: Number(process.env.PAGEHALL_FAKE_GRAPH_PORT ?? 4320) });
const google = await startFakeGoogleDirectory({
  port: Number(process.env.PAGEHALL_FAKE_GOOGLE_PORT ?? 4321),
});

process.stdout.write(`Microsoft Graph fake: ${graph.url} (token endpoint ${graph.tokenEndpoint()})
`);
process.stdout.write(`Google Directory fake: ${google.url} (token endpoint ${google.tokenEndpoint()})
`);

const stop = () => {
  void Promise.all([graph.close(), google.close()]).then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
