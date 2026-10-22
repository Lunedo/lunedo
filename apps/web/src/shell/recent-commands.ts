import { onSignOut } from "../session/sign-out.js";

const PREFIX = "lunedo.recentCommands.";
export const RECENT_COMMANDS = 5;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function recentCommands(accountId: string): string[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(`${PREFIX}${accountId}`) ?? "[]");
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_COMMANDS)
      : [];
  } catch {
    return [];
  }
}

export function rememberCommand(accountId: string, id: string): void {
  const next = [id, ...recentCommands(accountId).filter((entry) => entry !== id)].slice(0, RECENT_COMMANDS);
  try {
    storage()?.setItem(`${PREFIX}${accountId}`, JSON.stringify(next));
  } catch {
    return;
  }
}

export function forgetRecentCommands(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
      (key): key is string => key?.startsWith(PREFIX) ?? false,
    );
    for (const key of keys) store.removeItem(key);
  } catch {
    return;
  }
}

onSignOut(forgetRecentCommands);
