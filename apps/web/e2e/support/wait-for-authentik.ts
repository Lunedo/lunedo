import { chromium } from "@playwright/test";

const base = process.env.LUNEDO_E2E_AUTHENTIK_URL || "http://authentik.localhost:9000";
const deadline = Date.now() + 5 * 60_000;
const log = (line: string) => process.stdout.write(`${line}\n`);

const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"] });
let attempt = 0;
let lastError = "";
try {
  while (Date.now() < deadline) {
    attempt += 1;
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/if/flow/default-authentication-flow/`, { timeout: 30_000 });
      await page.locator('input[name="uidField"]').waitFor({ state: "visible", timeout: 30_000 });
      log(`Authentik shows its sign-in form (attempt ${attempt}).`);
      process.exit(0);
    } catch (error) {
      lastError = String(error).split("\n")[0] ?? "";
      log(`Authentik is not ready yet (attempt ${attempt}): ${lastError}`);
    } finally {
      await page.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
} finally {
  await browser.close();
}
process.stderr.write(
  `Authentik did not show its sign-in form at ${base} within 5 minutes (last error: ${lastError}). The provider is slow or unavailable.\n`,
);
process.exit(1);
