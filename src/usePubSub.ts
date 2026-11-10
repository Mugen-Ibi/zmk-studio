import Emittery from "emittery";
import { useEffect } from "react";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
type Events = {
  "rpc_notification.core.lockStateChanged": LockState;
  "rpc_notification.keymap.unsavedChangesStatusChanged": boolean;
};
const emitter = new Emittery<
  Record<string, { data: unknown; signal?: AbortSignal }>
>();
export const publish = (name: string, data: unknown, signal?: AbortSignal) =>
  emitter.emit(name, { data, signal });
export const useSub = <K extends keyof Events>(
  name: K,
  callback: (data: Events[K]) => void | Promise<void>,
) => {
  useEffect(
    () =>
      emitter.on(name, ({ data, signal }) => {
        if (!signal?.aborted) return callback(data as Events[K]);
      }),
    [name, callback],
  );
};
