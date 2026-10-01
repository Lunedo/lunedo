import { useSyncExternalStore } from "react";

export interface Registry<T extends { id: string; order?: number }> {
  register(...entries: T[]): () => void;
  list(): readonly T[];
  subscribe(listener: () => void): () => void;
}

export function createRegistry<T extends { id: string; order?: number }>(): Registry<T> {
  let entries: readonly T[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    register(...added) {
      for (const entry of added) {
        if (entries.some((existing) => existing.id === entry.id)) {
          throw new Error(`Entry ${entry.id} is registered twice`);
        }
      }
      entries = [...entries, ...added].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
      emit();
      return () => {
        entries = entries.filter((entry) => !added.includes(entry));
        emit();
      };
    },
    list: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useRegistry<T extends { id: string; order?: number }>(registry: Registry<T>): readonly T[] {
  return useSyncExternalStore(registry.subscribe, registry.list, registry.list);
}
