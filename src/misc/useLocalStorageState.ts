import { useEffect, useState } from "react";
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  options: {
    serialize?: (value: T) => string;
    deserialize: (value: string) => T;
  },
) {
  const [state, setState] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? defaultValue : options.deserialize(saved);
    } catch {
      return defaultValue;
    }
  });
  const serialize = options.serialize;
  useEffect(() => {
    try {
      localStorage.setItem(key, serialize ? serialize(state) : String(state));
    } catch {
      /* Private browsing and full storage must not block editing. */
    }
  }, [state, key, serialize]);
  return [state, setState] as const;
}
