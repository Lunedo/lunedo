import { statSync } from "node:fs";
import { foreignEntries, foreignReport } from "./file-owners.ts";

const roots = process.argv.slice(2);

if (roots.length === 0) {
  console.error("Usage: node scripts/check-file-owners.ts <workspace> [<directory>...]");
  process.exit(1);
}

const uid = statSync(roots[0] as string).uid;
const found = foreignEntries(roots, uid);
if (found.length > 0) {
  const report = foreignReport(found, uid);
  console.log(`::error title=Files of another user::${report.split("\n")[0]}`);
  console.log(report);
  process.exit(1);
}
console.log(`Everything in ${roots.join(", ")} belongs to UID ${uid}.`);
