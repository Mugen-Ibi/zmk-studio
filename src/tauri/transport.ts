import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import type { AvailableDevice } from ".";
import { abortable } from "../misc/abortable";
type DataEvent = { sessionId: string; data: number[] };
type CloseEvent = { sessionId: string; error?: string };

export async function connectNative(
  command: string,
  dev: AvailableDevice,
  signal?: AbortSignal,
): Promise<RpcTransport> {
  const sessionId = crypto.randomUUID();
  const abortController = new AbortController();
  const unlisten: UnlistenFn[] = [];
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  let cancelled = false;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller;
    },
    cancel() {
      cancelled = true;
      abortController.abort();
    },
  });
  const cleanup = () => {
    unlisten.splice(0).forEach((fn) => fn());
    signal?.removeEventListener("abort", cancel);
  };
  const finish = (error?: unknown) => {
    if (ended) return;
    ended = true;
    cleanup();
    if (!cancelled) {
      if (error) input.error(error);
      else input.close();
    }
    abortController.abort(error);
  };
  const cancel = () => abortController.abort(signal?.reason);
  abortController.signal.addEventListener(
    "abort",
    () => {
      finish(abortController.signal.reason);
      void invoke("transport_close", { sessionId }).catch(() => {});
    },
    { once: true },
  );
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => abortController.abort(new Error("Connection timed out")),
    14000,
  );
  try {
    const ownListener = (pending: Promise<UnlistenFn>) =>
      abortable(
        pending.then((fn) => {
          if (abortController.signal.aborted) fn();
          else unlisten.push(fn);
        }),
        abortController.signal,
      );
    // Subscribe before native connect, including its first possible data event.
    await ownListener(
      listen<DataEvent>("connection_data", ({ payload }) => {
        if (!ended && payload.sessionId === sessionId)
          input.enqueue(new Uint8Array(payload.data));
      }),
    );
    await ownListener(
      listen<CloseEvent>("connection_disconnected", ({ payload }) => {
        if (payload.sessionId === sessionId)
          finish(payload.error ? new Error(payload.error) : undefined);
      }),
    );
    if (signal?.aborted) cancel();
    abortController.signal.throwIfAborted();
    await abortable(
      invoke(command, { id: dev.id, sessionId }),
      abortController.signal,
    );
    abortController.signal.throwIfAborted();
    const writable = new WritableStream<Uint8Array>({
      async write(data) {
        abortController.signal.throwIfAborted();
        try {
          await invoke("transport_send_data", {
            sessionId,
            data: Array.from(data),
          });
        } catch (error) {
          finish(error);
          throw error;
        }
      },
      close() {
        abortController.abort();
      },
      abort(reason) {
        abortController.abort(reason);
      },
    });
    return { label: dev.label, abortController, readable, writable };
  } catch (error) {
    finish(error);
    cleanup();
    void invoke("transport_close", { sessionId }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
