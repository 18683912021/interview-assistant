const handlers = new Set<() => Promise<void>>();

export function registerShutdownHandler(handler: () => Promise<void>): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

export async function prepareAppShutdown(): Promise<void> {
  await Promise.all([...handlers].map(handler => handler()));
}
