import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from 'react';

/** Drafts live only for this signed-in workspace, and never enter browser storage. */
export class WorkspaceDraftStore {
  private values = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  get<T>(key: string, initial: () => T): T {
    if (!this.values.has(key)) this.values.set(key, initial());
    return this.values.get(key) as T;
  }
  set<T>(key: string, value: T) {
    this.values.set(key, value);
    this.listeners.forEach(listener => listener());
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
const DraftContext = createContext<WorkspaceDraftStore | null>(null);
export function WorkspaceDraftProvider({children}: {children: ReactNode}) {
  const [store] = useState(() => new WorkspaceDraftStore());
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}
export function useWorkspaceDraft<T>(
  key: string,
  initial: () => T,
): [T, (value: SetStateAction<T>) => void] {
  const shared = useContext(DraftContext);
  const [local] = useState(() => new WorkspaceDraftStore());
  const store = shared || local;
  const value = useSyncExternalStore(store.subscribe, () => store.get(key, initial));
  const update = useCallback(
    (next: SetStateAction<T>) => {
      const previous = store.get(key, initial);
      store.set(key, typeof next === 'function' ? (next as (value: T) => T)(previous) : next);
    },
    [key, store, initial],
  );
  return [value, update];
}
