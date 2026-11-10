import {
  Request,
  Response,
  RpcConnection,
  RequestResponse,
  Notification,
} from "@zmkfirmware/zmk-studio-ts-client";
import {
  get_decoder,
  get_encoder,
} from "@zmkfirmware/zmk-studio-ts-client/framing";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { registerSession, RpcError } from "./logging";

export function createConnection(
  transport: RpcTransport,
  controller: AbortController,
): RpcConnection {
  const signal = controller.signal;
  let responses!: ReadableStreamDefaultController<RequestResponse>;
  let notifications!: ReadableStreamDefaultController<Notification>;
  const close = (reason: unknown = new RpcError("Disconnected")) => {
    if (!signal.aborted) controller.abort(reason);
    transport.abortController.abort(reason);
  };
  const requestBytes = new TransformStream<Request, Uint8Array>({
    transform(request, output) {
      output.enqueue(new Uint8Array(Request.encode(request).finish()));
    },
  });
  const conn: RpcConnection = {
    label: transport.label,
    current_request: 0,
    request_writable: requestBytes.writable,
    request_response_readable: new ReadableStream({
      start(c) {
        responses = c;
      },
    }),
    notification_readable: new ReadableStream({
      start(c) {
        notifications = c;
      },
    }),
  };
  const onAbort = () => {
    responses.error(signal.reason);
    notifications.error(signal.reason);
    transport.abortController.abort(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  transport.abortController.signal.addEventListener(
    "abort",
    () => close(transport.abortController.signal.reason),
    { once: true },
  );
  registerSession(conn, signal, close);
  void requestBytes.readable
    .pipeThrough(new TransformStream(get_encoder()), { signal })
    .pipeTo(transport.writable, { signal })
    .then(() => close(), close);
  void transport.readable
    .pipeThrough(new TransformStream(get_decoder()), { signal })
    .pipeTo(
      new WritableStream<Uint8Array>({
        write(bytes) {
          const message = Response.decode(bytes);
          if (message.requestResponse)
            responses.enqueue(message.requestResponse);
          if (message.notification) notifications.enqueue(message.notification);
        },
      }),
      { signal },
    )
    .then(() => close(), close);
  if (signal.aborted) onAbort();
  if (transport.abortController.signal.aborted)
    close(transport.abortController.signal.reason);
  return conn;
}
