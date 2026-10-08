type Listener = () => void;

const listeners = new Set<Listener>();

export function onSignOut(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function signedOut(): void {
  for (const listener of listeners) listener();
}
