import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useUndoRedo } from "../src/undoRedo";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
it("serializes edits and commits history only after success", async () => {
  const { result } = renderHook(useUndoRedo);
  const gate = deferred();
  const calls: string[] = [];
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current[0](async () => {
      calls.push("A");
      await gate.promise;
      return async () => {
        calls.push("undo A");
      };
    });
    second = result.current[0](async () => {
      calls.push("B");
      return async () => {
        calls.push("undo B");
      };
    });
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(calls).toEqual(["A"]);
  expect(result.current[6]).toBe(true);
  await act(async () => {
    gate.resolve();
    await Promise.all([first, second]);
  });
  await act(async () => {
    await result.current[1]();
    await result.current[1]();
  });
  expect(calls).toEqual(["A", "B", "undo B", "undo A"]);
});
it("retains history and unlocks on do, undo and redo rejection", async () => {
  const { result } = renderHook(useUndoRedo);
  const undo = vi.fn(async () => {});
  const edit = vi.fn(async () => undo);
  await act(async () => {
    await result.current[0](edit);
  });
  await act(async () => {
    await expect(
      result.current[0](async () => {
        throw Error("do");
      }),
    ).rejects.toThrow("do");
  });
  expect(result.current[3]).toBe(true);
  undo.mockRejectedValueOnce(Error("undo"));
  await act(async () => {
    await expect(result.current[1]()).rejects.toThrow("undo");
  });
  expect(result.current[3]).toBe(true);
  expect(result.current[4]).toBe(false);
  await act(async () => {
    await result.current[1]();
  });
  edit.mockRejectedValueOnce(Error("redo"));
  await act(async () => {
    await expect(result.current[2]()).rejects.toThrow("redo");
  });
  expect(result.current[4]).toBe(true);
  expect(result.current[6]).toBe(false);
  await act(async () => {
    await result.current[2]();
  });
  expect(result.current[3]).toBe(true);
});
it("invalidates queued and inflight history on reset", async () => {
  const { result } = renderHook(useUndoRedo);
  const gate = deferred();
  const oldUndo = vi.fn();
  const queued = vi.fn();
  let pending!: Promise<void>;
  let next!: Promise<void>;
  act(() => {
    pending = result.current[0](async () => {
      await gate.promise;
      return oldUndo;
    });
    next = result.current[0](queued);
  });
  await act(async () => {
    await Promise.resolve();
  });
  act(() => result.current[5]());
  await act(async () => {
    gate.resolve();
    await Promise.all([pending, next]);
    await result.current[1]();
  });
  expect(result.current[3]).toBe(false);
  expect(result.current[4]).toBe(false);
  expect(oldUndo).not.toHaveBeenCalled();
  expect(queued).not.toHaveBeenCalled();
});
