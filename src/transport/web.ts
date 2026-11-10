import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";

/** Own the port locks so teardown can cancel a pending read/write before closing. */
export async function connectSerial(
  signal?: AbortSignal,
): Promise<RpcTransport> {
  const port = await navigator.serial.requestPort({});
  signal?.throwIfAborted();
  await port.open({ baudRate: 12500 });
  if (signal?.aborted) {
    await port.close();
    signal.throwIfAborted();
  }
  if (!port.readable || !port.writable) {
    await port.close();
    throw new Error("Serial streams unavailable");
  }
  const reader = port.readable.getReader();
  const writer = port.writable.getWriter();
  const abortController = new AbortController();
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  let ended = false;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller;
    },
    cancel(reason) {
      cancelled = true;
      abortController.abort(reason);
    },
  });
  const pump = (async () => {
    try {
      while (!abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!cancelled) input.enqueue(value);
      }
    } catch (error) {
      if (!cancelled && !ended) {
        input.error(error);
        ended = true;
      }
    } finally {
      reader.releaseLock();
      if (!cancelled && !ended) {
        input.close();
        ended = true;
      }
      abortController.abort();
    }
  })();
  abortController.signal.addEventListener(
    "abort",
    () => {
      void (async () => {
        await Promise.allSettled([
          reader.cancel(),
          writer.abort(abortController.signal.reason),
        ]);
        await pump;
        writer.releaseLock();
        await port.close();
      })().catch(() => {});
    },
    { once: true },
  );
  const writable = new WritableStream<Uint8Array>({
    async write(data) {
      abortController.signal.throwIfAborted();
      try {
        await writer.write(data);
      } catch (error) {
        abortController.abort(error);
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
  const info = port.getInfo();
  return {
    label: `${info.usbVendorId ?? ""}:${info.usbProductId ?? ""}`,
    abortController,
    readable,
    writable,
  };
}

const SERVICE = "00000000-0196-6107-c967-c5cfb1c2482a";
const CHARACTERISTIC = "00000001-0196-6107-c967-c5cfb1c2482a";
export async function connectBluetooth(
  signal?: AbortSignal,
): Promise<RpcTransport> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE] }],
  });
  signal?.throwIfAborted();
  const server = device.gatt;
  if (!server) throw new Error("Bluetooth GATT is unavailable");
  const abortController = new AbortController();
  let characteristic: BluetoothRemoteGATTCharacteristic | undefined;
  let input!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  let ended = false;
  const changed = () => {
    const value = characteristic?.value;
    if (!ended && value)
      input.enqueue(
        new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        ).slice(),
      );
  };
  const disconnected = () =>
    abortController.abort(new Error("Bluetooth disconnected"));
  const abort = () => {
    if (ended) return;
    ended = true;
    characteristic?.removeEventListener("characteristicvaluechanged", changed);
    device.removeEventListener("gattserverdisconnected", disconnected);
    if (!cancelled) input.error(abortController.signal.reason);
    server.disconnect();
  };
  const cancelSetup = () => abortController.abort(signal?.reason);
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      input = controller;
    },
    cancel(reason) {
      cancelled = true;
      abortController.abort(reason);
    },
  });
  abortController.signal.addEventListener("abort", abort, { once: true });
  signal?.addEventListener("abort", cancelSetup, { once: true });
  device.addEventListener("gattserverdisconnected", disconnected);
  try {
    if (!server.connected) await server.connect();
    abortController.signal.throwIfAborted();
    const service = await server.getPrimaryService(SERVICE);
    characteristic = await service.getCharacteristic(CHARACTERISTIC);
    abortController.signal.throwIfAborted();
    // The listener must exist before notifications can begin.
    characteristic.addEventListener("characteristicvaluechanged", changed);
    await characteristic.stopNotifications();
    await characteristic.startNotifications();
    abortController.signal.throwIfAborted();
    const ready = characteristic;
    const writable = new WritableStream<Uint8Array>({
      async write(data) {
        abortController.signal.throwIfAborted();
        try {
          await ready.writeValueWithoutResponse(new Uint8Array(data));
        } catch (error) {
          abortController.abort(error);
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
    return {
      label: device.name ?? "Unknown",
      abortController,
      readable,
      writable,
    };
  } catch (error) {
    abortController.abort(error);
    server.disconnect();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelSetup);
  }
}
