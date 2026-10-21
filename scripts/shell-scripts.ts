export const SHELLCHECK_IMAGE =
  "koalaman/shellcheck:v0.11.0@sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d";

export function shellScripts(trackedFiles: readonly string[]): string[] {
  return trackedFiles.filter((file) => file.endsWith(".sh")).sort();
}

export function shellcheckArguments(root: string, scripts: readonly string[]): string[] {
  return [
    "run",
    "--rm",
    "-v",
    `${root}:/mnt:ro`,
    "-w",
    "/mnt",
    SHELLCHECK_IMAGE,
    "--severity=style",
    ...scripts,
  ];
}
