import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

const SetupDraftsContext = createContext<Map<string, unknown> | null>(null);

export function SetupDraftsProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, unknown>());
  return <SetupDraftsContext.Provider value={drafts}>{children}</SetupDraftsContext.Provider>;
}

export function useDraftDefaults<T extends FieldValues>(key: string, defaults: T): T {
  const drafts = useContext(SetupDraftsContext);
  return (drafts?.get(key) as T | undefined) ?? defaults;
}

export function useKeepDraft<T extends FieldValues>(
  key: string,
  form: UseFormReturn<T, unknown, unknown>,
): void {
  const drafts = useContext(SetupDraftsContext);
  useEffect(() => () => void drafts?.set(key, form.getValues()), [drafts, key, form]);
}
