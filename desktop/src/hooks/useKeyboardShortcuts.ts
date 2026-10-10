import {useEffect} from 'react';
export function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
      const key = [
        e.ctrlKey || e.metaKey ? 'Ctrl' : '',
        e.shiftKey ? 'Shift' : '',
        e.key.length === 1 ? e.key.toUpperCase() : e.key,
      ]
        .filter(Boolean)
        .join('+');
      if (shortcuts[key]) {
        e.preventDefault();
        shortcuts[key]?.();
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [shortcuts]);
}
