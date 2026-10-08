let pastedStates: readonly boolean[] | null = null;
const pending = new Map<string, boolean>();

export function withPastedTaskStates<T>(states: readonly boolean[], run: () => T): T {
  pastedStates = states;
  try {
    return run();
  } finally {
    pastedStates = null;
  }
}

export function pastedTaskState(index: number): boolean | undefined {
  return pastedStates?.[index];
}

export function rememberTaskStatus(taskId: string, done: boolean): void {
  pending.set(taskId, done);
}

export function takeTaskStatus(taskId: string): boolean | undefined {
  const done = pending.get(taskId);
  pending.delete(taskId);
  return done;
}
