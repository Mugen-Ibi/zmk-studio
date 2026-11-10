import { AppHeader } from "./AppHeader";

import { createConnection } from "./rpc/connection";
import { call_rpc } from "./rpc/logging";

import type { Notification } from "@zmkfirmware/zmk-studio-ts-client/studio";
import { ConnectionState, ConnectionContext } from "./rpc/ConnectionContext";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ConnectModal, TransportFactory } from "./ConnectModal";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import {
  connectBluetooth as gatt_connect,
  connectSerial as serial_connect,
} from "./transport/web";

import {
  connect as tauri_ble_connect,
  list_devices as ble_list_devices,
} from "./tauri/ble";
import {
  connect as tauri_serial_connect,
  list_devices as serial_list_devices,
} from "./tauri/serial";
import Keyboard from "./keyboard/Keyboard";
import { UndoRedoContext, useUndoRedo } from "./undoRedo";
import { publish, useSub } from "./usePubSub";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { LockStateContext } from "./rpc/LockStateContext";
import { UnlockModal } from "./UnlockModal";
import { AppFooter } from "./AppFooter";
const AboutModal = lazy(() =>
  import("./AboutModal").then((module) => ({ default: module.AboutModal })),
);
const LicenseNoticeModal = lazy(() =>
  import("./misc/LicenseNoticeModal").then((module) => ({
    default: module.LicenseNoticeModal,
  })),
);

declare global {
  interface Window {
    __TAURI_INTERNALS__?: object;
  }
}

const TRANSPORTS: TransportFactory[] = [
  navigator.serial && { label: "USB", connect: serial_connect },
  ...(navigator.bluetooth && navigator.userAgent.indexOf("Linux") >= 0
    ? [{ label: "BLE", connect: gatt_connect }]
    : []),
  ...(window.__TAURI_INTERNALS__
    ? [
        {
          label: "BLE",
          isWireless: true,
          pick_and_connect: {
            connect: tauri_ble_connect,
            list: ble_list_devices,
          },
        },
      ]
    : []),
  ...(window.__TAURI_INTERNALS__
    ? [
        {
          label: "USB",
          pick_and_connect: {
            connect: tauri_serial_connect,
            list: serial_list_devices,
          },
        },
      ]
    : []),
].filter((t) => t !== undefined);

async function listenForNotifications(
  stream: ReadableStream<Notification>,
  signal: AbortSignal,
) {
  const reader = stream.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      if (!value) continue;
      for (const [subsystem, events] of Object.entries(value)) {
        if (!events) continue;
        for (const [event, data] of Object.entries(events)) {
          if (data !== undefined && !signal.aborted)
            await publish(
              `rpc_notification.${subsystem}.${event}`,
              data,
              signal,
            );
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function App({
  transports = TRANSPORTS,
}: { transports?: TransportFactory[] } = {}) {
  const [conn, setConn] = useState<ConnectionState>({ conn: null });
  const [connectedDeviceName, setConnectedDeviceName] = useState<string>();
  const [doIt, undo, redo, canUndo, canRedo, reset, busy, run] = useUndoRedo();
  const [showAbout, setShowAbout] = useState(false);
  const [showLicenseNotice, setShowLicenseNotice] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<AbortController>();
  const [generation, setGeneration] = useState(0);
  const [lockState, setLockState] = useState(
    LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED,
  );
  const reportError = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason));
  }, []);
  useSub("rpc_notification.core.lockStateChanged", setLockState);

  const clearSession = useCallback(() => {
    reset();
    setConn({ conn: null });
    setConnectedDeviceName(undefined);
    setLockState(LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED);
    setGeneration((g) => g + 1);
  }, [reset]);

  useEffect(() => () => active.current?.abort(), []);

  const onConnect = useCallback(
    async (transport: RpcTransport, signal?: AbortSignal) => {
      active.current?.abort();
      clearSession();
      setError(undefined);
      const controller = new AbortController();
      active.current = controller;
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", cancel, { once: true });
      const current = () =>
        active.current === controller && !controller.signal.aborted;
      controller.signal.addEventListener(
        "abort",
        () => {
          if (active.current === controller) {
            active.current = undefined;
            clearSession();
          }
        },
        { once: true },
      );
      const connection = createConnection(transport, controller);
      // Drain notifications during the handshake too.
      void listenForNotifications(
        connection.notification_readable,
        controller.signal,
      )
        .catch((reason) => {
          if (current()) reportError(reason);
        })
        .finally(() => controller.abort());
      try {
        if (signal?.aborted) cancel();
        const details = (
          await call_rpc(connection, { core: { getDeviceInfo: true } })
        ).core?.getDeviceInfo;
        if (!details) throw new Error("Device information is unavailable");
        const lock = (
          await call_rpc(connection, { core: { getLockState: true } })
        ).core?.getLockState;
        if (!current()) throw new Error("Connection cancelled");
        setConnectedDeviceName(details.name);
        setLockState(lock ?? LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED);
        setConn({ conn: connection });
      } catch (reason) {
        controller.abort(reason);
        throw reason;
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    },
    [clearSession, reportError],
  );

  const execute = useCallback(
    (operation: () => Promise<void>) => {
      setError(undefined);
      return run(operation).catch(reportError);
    },
    [run, reportError],
  );

  const save = useCallback(
    () =>
      execute(async () => {
        if (!conn.conn) throw new Error("Not connected");
        const response = await call_rpc(conn.conn, {
          keymap: { saveChanges: true },
        });
        if (
          !response.keymap?.saveChanges?.ok ||
          response.keymap.saveChanges.err
        )
          throw new Error("The device could not save changes");
      }),
    [conn, execute],
  );

  const discard = useCallback(
    () =>
      execute(async () => {
        if (!conn.conn) throw new Error("Not connected");
        const response = await call_rpc(conn.conn, {
          keymap: { discardChanges: true },
        });
        if (!response.keymap?.discardChanges)
          throw new Error("The device could not discard changes");
        reset();
        setConn({ conn: conn.conn });
        setGeneration((g) => g + 1);
      }),
    [conn, execute, reset],
  );

  const resetSettings = useCallback(
    () =>
      execute(async () => {
        if (!conn.conn) throw new Error("Not connected");
        const response = await call_rpc(conn.conn, {
          core: { resetSettings: true },
        });
        if (!response.core?.resetSettings)
          throw new Error("The device could not restore stock settings");
        reset();
        setConn({ conn: conn.conn });
        setGeneration((g) => g + 1);
      }),
    [conn, execute, reset],
  );

  const disconnect = useCallback(() => active.current?.abort(), []);
  const edit = useCallback(
    (command: Parameters<typeof doIt>[0]) => {
      setError(undefined);
      return doIt(command).catch(reportError);
    },
    [doIt, reportError],
  );

  return (
    <ConnectionContext.Provider value={conn}>
      <LockStateContext.Provider value={lockState}>
        <UndoRedoContext.Provider value={edit}>
          <UnlockModal />
          <ConnectModal
            open={!conn.conn}
            transports={transports}
            onTransportCreated={onConnect}
          />
          <Suspense fallback={null}>
            {showAbout && (
              <AboutModal open onClose={() => setShowAbout(false)} />
            )}
          </Suspense>
          <Suspense fallback={null}>
            {showLicenseNotice && (
              <LicenseNoticeModal
                open
                onClose={() => setShowLicenseNotice(false)}
              />
            )}
          </Suspense>
          <div className="bg-base-100 text-base-content h-full max-h-[100vh] w-full max-w-[100vw] flex flex-col overflow-hidden">
            <AppHeader
              connectedDeviceLabel={connectedDeviceName}
              canUndo={canUndo}
              canRedo={canRedo}
              busy={busy}
              onUndo={() => undo().catch(reportError)}
              onRedo={() => redo().catch(reportError)}
              onSave={save}
              onDiscard={discard}
              onDisconnect={disconnect}
              onResetSettings={resetSettings}
            />
            {error && (
              <div role="alert" className="p-2 bg-red-100 text-red-900">
                {error}
                <button
                  aria-label="Dismiss error"
                  className="ml-4"
                  onClick={() => setError(undefined)}
                >
                  ×
                </button>
              </div>
            )}
            {busy && (
              <div role="status" className="px-2">
                Applying changes…
              </div>
            )}
            <fieldset
              disabled={busy}
              aria-busy={busy}
              className="flex-1 min-h-0 min-w-0 grid border-0 m-0 p-0"
              style={{ pointerEvents: busy ? "none" : undefined }}
            >
              <Keyboard key={generation} />
            </fieldset>
            <AppFooter
              onShowAbout={() => setShowAbout(true)}
              onShowLicenseNotice={() => setShowLicenseNotice(true)}
            />
          </div>
        </UndoRedoContext.Provider>
      </LockStateContext.Provider>
    </ConnectionContext.Provider>
  );
}
export default App;
