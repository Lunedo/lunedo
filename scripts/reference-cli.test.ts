import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CliSource, prose, renderCli, usageSections } from "./reference-cli.ts";

const wrapper = [
  "usage() {",
  "  cat <<'USAGE'",
  "Usage:",
  "  tool update [version]    Update this installation",
  "  tool version             Show the version",
  "",
  "Options:",
  "  --dir <directory>     Installation directory (default /opt/tool, on macOS ~/tool)",
  "  --proxy <address>     Fixed address of a proxy, the only address",
  "                        trusted for forwarded headers",
  "",
  "Exit codes:",
  "  0                     Success",
  "  backup ends with the exit code of the command in the container.",
  "USAGE",
  "}",
  "",
].join("\n");

const source: CliSource = {
  commands: [
    {
      synopsis: "backup create --output <file>",
      description: "Writes a backup to a file in /var/lib/tool/backups.",
      options: [{ flag: "--output <file>", description: "The file to write." }],
    },
    { synopsis: "version", description: "Prints the version.", options: [] },
  ],
  exitCodes: [
    { code: 64, description: "Unknown command or option." },
    { code: 0, description: "Success." },
  ],
  wrapper,
};

describe("command line reference", () => {
  it("reads commands, options with continued lines and exit codes from the usage of the script", () => {
    const sections = usageSections(wrapper);
    assert.deepEqual(
      sections.map((section) => section.title),
      ["Usage", "Options", "Exit codes"],
    );
    assert.deepEqual(sections[1]?.entries[1], {
      name: "--proxy <address>",
      description: "Fixed address of a proxy, the only address trusted for forwarded headers",
    });
    assert.deepEqual(sections[2]?.notes, ["backup ends with the exit code of the command in the container."]);
    assert.throws(() => usageSections("echo no usage"), /has no usage text/);
  });

  it("renders each command with its options and the exit codes in order", () => {
    const page = renderCli(source);
    assert.match(
      page,
      /### `lunedo backup create --output <file>`\n\nWrites a backup to a file in `\/var\/lib\/tool\/backups`\./,
    );
    assert.match(page, /\| `--output <file>` \| The file to write\. \|/);
    assert.doesNotMatch(page, /### `lunedo version`\n\nPrints the version\.\n\n\| Option/);
    assert.ok(page.indexOf("| `0` | Success. |") < page.indexOf("| `64` | Unknown command or option. |"));
  });

  it("renders the usage of the script as tables", () => {
    const page = renderCli(source);
    assert.match(
      page,
      /\| Command \| Description \|\n\|---\|---\|\n\| `tool update \[version\]` \| Update this installation\. \|/,
    );
    assert.match(
      page,
      /\| `--dir <directory>` \| Installation directory \(default `\/opt\/tool`, on macOS `~\/tool`\)\. \|/,
    );
    assert.match(page, /backup ends with the exit code of the command in the container\./);
  });

  it("puts paths, addresses, options, variables and placeholders in code", () => {
    assert.equal(
      prose("Use --since <version> or LUNEDO_X with s3://<bucket>/<key>, image:<tag> and /data."),
      "Use `--since <version>` or `LUNEDO_X` with `s3://<bucket>/<key>`, `image:<tag>` and `/data`.",
    );
    assert.equal(prose("Already `--json` here."), "Already `--json` here.");
  });
});
