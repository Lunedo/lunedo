import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findFormerName, imageNameProblems } from "./product-name.ts";

const names = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean);

const findings: string[] = [];
const images: string[] = [];
for (const name of names) {
  const bytes = readFileSync(name);
  const data = name.endsWith(".gz") ? gunzipSync(bytes) : bytes;
  const content = data.includes(0) ? "" : data.toString("utf8");
  for (const finding of findFormerName(content, name)) {
    findings.push(finding.line === 0 ? `${name}: file name` : `${name}:${finding.line}: ${finding.text}`);
  }
  images.push(...imageNameProblems(content, name));
}
if (findings.length > 0) {
  console.error("The former product name is left outside the allowed database names and migrations:");
  for (const finding of findings) console.error(`  ${finding}`);
}
if (images.length > 0) {
  console.error("Image names are not lowercase:");
  for (const problem of images) console.error(`  ${problem}`);
}
if (findings.length > 0 || images.length > 0) process.exit(1);
console.log(`Checked ${names.length} files for the former product name and image names`);
