import { appendFileSync, readFileSync } from "node:fs";
import { formatReport, latestRelease, pinnedVersion, SHEETJS_TAGS_URL } from "./sheetjs-release.ts";

const manifest = JSON.parse(readFileSync("apps/web/package.json", "utf8")) as {
  dependencies?: Record<string, string>;
};
const pinned = pinnedVersion(manifest.dependencies?.xlsx);
let latest: string | null = null;
try {
  const response = await fetch(SHEETJS_TAGS_URL, { signal: AbortSignal.timeout(30_000) });
  if (response.ok) latest = latestRelease((await response.json()) as { name?: unknown }[]);
} catch (error) {
  console.error(`Reading the SheetJS releases failed: ${String(error)}`);
}
const report = formatReport(pinned, latest);
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (pinned && latest && report.includes("is available")) {
  console.log(`::warning title=SheetJS release::SheetJS ${latest} is available; Pagehall pins ${pinned}.`);
}
