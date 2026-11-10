import {
  Request,
  RequestResponse,
  RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client";

export class RpcError extends Error {}
export class RpcTimeoutError extends RpcError {}
export class FirmwareError extends RpcError {}
type Session = {
  tail: Promise<unknown>;
  signal: AbortSignal;
  close: (reason: unknown) => void;
};
const sessions = new WeakMap<RpcConnection, Session>();
export function registerSession(
  conn: RpcConnection,
  signal: AbortSignal,
  close: Session["close"],
) {
  sessions.set(conn, { tail: Promise.resolve(), signal, close });
}

/** Each connection owns its queue. A timeout cancels I/O as well as the wait. */
export function call_rpc(
  conn: RpcConnection,
  req: Omit<Request, "requestId">,
  timeoutMs = 5000,
): Promise<RequestResponse> {
  let session = sessions.get(conn);
  if (!session) {
    const controller = new AbortController();
    session = {
      tail: Promise.resolve(),
      signal: controller.signal,
      close: (r) => controller.abort(r),
    };
    sessions.set(conn, session);
  }
  const current = session;
  const result = current.tail.then(async () => {
    current.signal.throwIfAborted();
    const reader = conn.request_response_readable.getReader();
    const writer = conn.request_writable.getWriter();
    const request = { ...req, requestId: conn.current_request++ };
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () =>
        reject(current.signal.reason ?? new RpcError("Disconnected"));
      current.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        const error = new RpcTimeoutError(
          "The device did not respond. Please reconnect.",
        );
        reject(error);
        current.close(error);
      }, timeoutMs);
    });
    try {
      const io = async () => {
        await writer.write(request);
        const { done, value } = await reader.read();
        if (done || !value)
          throw new RpcError("Device disconnected before responding");
        if (value.requestId !== request.requestId)
          throw new RpcError("Unexpected RPC response ID");
        if (value.meta?.noResponse || value.meta?.simpleError !== undefined) {
          throw new FirmwareError(
            `Device rejected the request: ${value.meta?.simpleError ?? "no response"}`,
          );
        }
        return value;
      };
      return await Promise.race([io(), interrupted]);
    } catch (error) {
      if (!(error instanceof FirmwareError)) {
        current.close(error);
        void reader.cancel(error).catch(() => {});
        void writer.abort(error).catch(() => {});
      }
      throw error;
    } finally {
      clearTimeout(timer!);
      current.signal.removeEventListener("abort", abort);
      reader.releaseLock();
      writer.releaseLock();
    }
  });
  current.tail = result.catch(() => {});
  return result;
}
