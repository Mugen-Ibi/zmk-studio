import { afterEach, expect, it, vi } from "vitest";
import { connectSerial, connectBluetooth } from "../src/transport/web";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("releases browser serial stream locks and closes the port on cancellation", async () => {
  const readable = new ReadableStream<Uint8Array>();
  const writable = new WritableStream<Uint8Array>();
  const close = vi.fn(async () => {
    expect(readable.locked).toBe(false);
    expect(writable.locked).toBe(false);
  });
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), {
      serial: {
        requestPort: async () => ({
          readable,
          writable,
          open: async () => {},
          close,
          getInfo: () => ({}),
        }),
      } as unknown as Serial,
    }),
  );
  const transport = await connectSerial();
  transport.abortController.abort();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("does not announce browser BLE readiness before notification subscription, and surfaces write failure", async () => {
  let ready!: () => void;
  const characteristic = Object.assign(new EventTarget(), {
    value: new DataView(new Uint8Array([1, 2, 3]).buffer),
    stopNotifications: async () => {},
    startNotifications: () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    writeValueWithoutResponse: async () => {
      throw Error("radio write failed");
    },
  });
  const disconnect = vi.fn();
  const device = Object.assign(new EventTarget(), {
    name: "BLE",
    gatt: {
      connected: true,
      disconnect,
      getPrimaryService: async () => ({
        getCharacteristic: async () => characteristic,
      }),
    },
  });
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), {
      bluetooth: { requestDevice: async () => device } as unknown as Bluetooth,
    }),
  );
  let resolved = false;
  const pending = connectBluetooth().then((t) => {
    resolved = true;
    return t;
  });
  await vi.waitFor(() => expect(ready).toBeDefined());
  expect(resolved).toBe(false);
  characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
  ready();
  const transport = await pending;
  expect(
    Array.from((await transport.readable.getReader().read()).value!),
  ).toEqual([1, 2, 3]);
  await expect(
    transport.writable.getWriter().write(new Uint8Array([4])),
  ).rejects.toThrow("radio write failed");
  expect(disconnect).toHaveBeenCalledOnce();
  expect(transport.abortController.signal.aborted).toBe(true);
});
