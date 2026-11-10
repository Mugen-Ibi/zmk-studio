import { enumerateDevices } from "./tauri/enumerate";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { AvailableDevice } from "./tauri";
import { useModalRef } from "./misc/useModalRef";
import { ExternalLink } from "./misc/ExternalLink";
import { GenericModal } from "./GenericModal";

export type TransportFactory = {
  label: string;
  isWireless?: boolean;
  connect?: (signal?: AbortSignal) => Promise<RpcTransport>;
  pick_and_connect?: {
    list: () => Promise<AvailableDevice[]>;
    connect: (
      dev: AvailableDevice,
      signal?: AbortSignal,
    ) => Promise<RpcTransport>;
  };
};
export interface ConnectModalProps {
  open?: boolean;
  transports: TransportFactory[];
  onTransportCreated: (
    t: RpcTransport,
    signal?: AbortSignal,
  ) => void | Promise<void>;
}
export const ConnectModal = ({
  open = false,
  transports,
  onTransportCreated,
}: ConnectModalProps) => {
  const dialog = useModalRef(open, false, false);
  const [devices, setDevices] = useState<
    Awaited<ReturnType<typeof enumerateDevices>>["devices"]
  >([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const attempt = useRef<AbortController>();
  const refreshId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    setRefreshing(true);
    try {
      const result = await enumerateDevices(transports);
      if (id === refreshId.current) {
        setDevices(result.devices);
        setErrors(result.errors);
      }
    } finally {
      if (id === refreshId.current) setRefreshing(false);
    }
  }, [transports]);
  useEffect(() => {
    if (open) void refresh();
    const id = refreshId.current;
    return () => {
      refreshId.current = id + 1;
    };
  }, [open, refresh]);
  useEffect(() => () => attempt.current?.abort(), []);

  const connect = async (
    factory: TransportFactory,
    device?: AvailableDevice,
  ) => {
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setConnecting(true);
    setErrors([]);
    const timer = setTimeout(
      () => controller.abort(new Error("Connection timed out")),
      15000,
    );
    const pending = device
      ? factory.pick_and_connect!.connect(device, controller.signal)
      : factory.connect!(controller.signal);
    // Browser device choosers cannot be dismissed programmatically. Dispose any late result.
    void pending.then(
      (t) => {
        if (controller.signal.aborted) t.abortController.abort();
      },
      () => {},
    );
    try {
      const cancelled = new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        ),
      );
      const transport = await Promise.race([pending, cancelled]);
      await onTransportCreated(transport, controller.signal);
    } catch (e) {
      if (
        !(e instanceof UserCancelledError) &&
        !(e instanceof DOMException && e.name === "AbortError")
      ) {
        setErrors([e instanceof Error ? e.message : JSON.stringify(e)]);
      }
    } finally {
      clearTimeout(timer);
      if (attempt.current === controller) attempt.current = undefined;
      setConnecting(false);
    }
  };
  return (
    <GenericModal ref={dialog} className="max-w-xl">
      <h1 className="text-xl">Welcome to ZMK Studio</h1>
      {transports.length === 0 ? (
        <p>
          Your browser is not supported. Use Chrome/Edge or{" "}
          <ExternalLink href="/download.html">
            download the application
          </ExternalLink>
          .
        </p>
      ) : (
        <>
          <p>Select a connection type or device.</p>
          <div className="flex gap-2 py-2">
            {transports
              .filter((t) => t.connect)
              .map((t) => (
                <button
                  key={t.label}
                  disabled={connecting}
                  className="rounded bg-base-300 px-2 py-1"
                  onClick={() => void connect(t)}
                >
                  {t.label}
                </button>
              ))}
          </div>
          {transports.some((t) => t.pick_and_connect) && (
            <>
              <button
                aria-label="Refresh devices"
                disabled={refreshing || connecting}
                onClick={() => void refresh()}
              >
                {refreshing ? "Refreshing…" : "Refresh devices"}
              </button>
              <ul>
                {devices.map(({ transport, device }) => (
                  <li key={transport.label + device.id}>
                    <button
                      disabled={connecting}
                      className="rounded hover:bg-base-300 p-1"
                      onClick={() => void connect(transport, device)}
                    >
                      {transport.label}: {device.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {connecting && (
            <div role="status">
              Connecting…{" "}
              <button onClick={() => attempt.current?.abort()}>Cancel</button>
            </div>
          )}
        </>
      )}
      {errors.map((error, i) => (
        <p role="alert" key={i}>
          {error}
        </p>
      ))}
    </GenericModal>
  );
};
