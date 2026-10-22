export const DEVELOPMENT_VERSION = "dev";

const RELEASE = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
}

export function lunedoVersion(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = env.LUNEDO_VERSION?.trim();
  return value ? value : DEVELOPMENT_VERSION;
}

export function parseReleaseVersion(value: string): ReleaseVersion | null {
  const match = RELEASE.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareVersions(left: ReleaseVersion, right: ReleaseVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function formatVersion(version: ReleaseVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
