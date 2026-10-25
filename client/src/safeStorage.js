// Optional browser persistence must never prevent a game from starting.
export function createSafeStorage(getStorage) {
  const memory = new Map();
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try { return getStorage().getItem(key); } catch { return null; }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try { getStorage().setItem(key, String(value)); } catch { /* memory fallback */ }
    }
  };
}
export const safeStorage = createSafeStorage(() => window.localStorage);
