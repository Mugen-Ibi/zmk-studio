import { createContext, useCallback, useRef, useState } from "react";
export type UndoCallback = () => Promise<void>;
export type DoCallback = () => Promise<UndoCallback>;

export function useUndoRedo() {
  const state = useRef({
    generation: 0,
    undo: [] as [DoCallback, UndoCallback][],
    redo: [] as DoCallback[],
    pending: 0,
    tail: Promise.resolve(),
  });
  const [, render] = useState(0);
  const update = useCallback(() => render((n) => n + 1), []);
  const enqueue = useCallback(
    (operation: (isCurrent: () => boolean) => Promise<void>) => {
      const s = state.current;
      const generation = s.generation;
      s.pending++;
      update();
      const isCurrent = () => s.generation === generation;
      const result = s.tail.then(async () => {
        if (!isCurrent()) return;
        try {
          await operation(isCurrent);
        } finally {
          if (isCurrent()) {
            s.pending--;
            update();
          }
        }
      });
      s.tail = result.catch(() => {});
      return result;
    },
    [update],
  );
  const doIt = useCallback(
    (callback: DoCallback) =>
      enqueue(async (current) => {
        const undo = await callback();
        if (current()) {
          state.current.undo.unshift([callback, undo]);
          state.current.redo = [];
        }
      }),
    [enqueue],
  );
  const undo = useCallback(
    () =>
      enqueue(async (current) => {
        const entry = state.current.undo[0];
        if (!entry) return;
        await entry[1]();
        if (current()) {
          state.current.undo.shift();
          state.current.redo.unshift(entry[0]);
        }
      }),
    [enqueue],
  );
  const redo = useCallback(
    () =>
      enqueue(async (current) => {
        const callback = state.current.redo[0];
        if (!callback) return;
        const undo = await callback();
        if (current()) {
          state.current.redo.shift();
          state.current.undo.unshift([callback, undo]);
        }
      }),
    [enqueue],
  );
  const reset = useCallback(() => {
    const s = state.current;
    s.generation++;
    s.undo = [];
    s.redo = [];
    s.pending = 0;
    s.tail = Promise.resolve();
    update();
  }, [update]);
  const run = useCallback(
    (operation: () => Promise<void>) => enqueue(operation),
    [enqueue],
  );
  const s = state.current;
  return [
    doIt,
    undo,
    redo,
    s.pending === 0 && s.undo.length > 0,
    s.pending === 0 && s.redo.length > 0,
    reset,
    s.pending > 0,
    run,
  ] as const;
}
export const UndoRedoContext = createContext<
  ((dc: DoCallback) => Promise<void>) | null
>(null);
