export const CLIENT_API_LEVEL = 1;

export const CLIENT_API_HEADER = "X-Lunedo-Client-Api";

export const CLIENT_BUILD_HEADER = "X-Lunedo-Build";

export const CLIENT_BUILD_FILE = "build.json";

export const CLIENT_BUILD_META = "lunedo-build";

export function clientApiLevel(value: string | undefined | null): number | null {
  if (!value || !/^\d{1,6}$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function acceptsClientApiLevel(
  value: string | undefined | null,
  required = CLIENT_API_LEVEL,
): boolean {
  const level = clientApiLevel(value);
  return level === null || level >= required;
}
