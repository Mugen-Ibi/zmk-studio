import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (event: string, cb: (event: { payload: unknown }) => void) => {
      const listeners = mocks.listeners.get(event) ?? new Set();
      listeners.add(cb);
      mocks.listeners.set(event, listeners);
      return () => {
        listeners.delete(cb);
      };
    },
  ),
}));
import { connect as usb } from "../src/tauri/serial";
import { connect as ble } from "../src/tauri/ble";
const emit = (event: string, payload: unknown) =>
  mocks.listeners.get(event)?.forEach((cb) => cb({ payload }));
beforeEach(() => {
  mocks.listeners.clear();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
});
describe.each([
  ["USB", usb, "serial_connect"],
  ["BLE", ble, "gatt_connect"],
] as const)("%s contract", (_, connect, command) => {
  it("waits for readiness and bounds a hung native setup even when close also hangs", async () => {
    vi.useFakeTimers();
    try {
      mocks.invoke.mockImplementation(() => new Promise(() => {}));
      const pending = connect({ id: "A", label: "A" });
      const rejection = expect(pending).rejects.toThrow("Connection timed out");
      await vi.advanceTimersByTimeAsync(14000);
      await rejection;
      expect(mocks.listeners.get("connection_data")?.size).toBe(0);
      expect(mocks.invoke).toHaveBeenCalledWith(
        "transport_close",
        expect.objectContaining({ sessionId: expect.any(String) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("subscribes before connect and preserves burst data with a delayed reader", async () => {
    let id = "";
    mocks.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === command) {
        id = args.sessionId;
        expect(mocks.listeners.get("connection_data")?.size).toBe(1);
        emit("connection_data", { sessionId: id, data: [1, 2, 3] });
        emit("connection_data", { sessionId: id, data: [4, 5, 6] });
      }
    });
    const transport = await connect({ id: "1", label: "test" });
    const reader = transport.readable.getReader();
    emit("connection_disconnected", { sessionId: id });
    expect(Array.from((await reader.read()).value!)).toEqual([1, 2, 3]);
    expect(Array.from((await reader.read()).value!)).toEqual([4, 5, 6]);
    expect((await reader.read()).done).toBe(true);
    expect(mocks.listeners.get("connection_data")?.size).toBe(0);
  });
  it("ignores stale events and reports native send failure", async () => {
    const a = await connect({ id: "A", label: "A" });
    const oldId = mocks.invoke.mock.calls.find((c) => c[0] === command)![1]
      .sessionId;
    a.abortController.abort();
    const b = await connect({ id: "B", label: "B" });
    emit("connection_disconnected", { sessionId: oldId, error: "late A" });
    expect(b.abortController.signal.aborted).toBe(false);
    mocks.invoke.mockImplementation(async (cmd) => {
      if (cmd === "transport_send_data") throw Error("write failed");
    });
    await expect(
      b.writable.getWriter().write(new Uint8Array([1])),
    ).rejects.toThrow("write failed");
    expect(b.abortController.signal.aborted).toBe(true);
  });
  it("cleans listeners on setup rejection and cancellation", async () => {
    mocks.invoke.mockImplementation(async (cmd) => {
      if (cmd === command) throw Error("subscription denied");
    });
    await expect(connect({ id: "A", label: "A" })).rejects.toThrow(
      "subscription denied",
    );
    expect(mocks.listeners.get("connection_data")?.size).toBe(0);
    const ac = new AbortController();
    ac.abort(Error("cancel"));
    await expect(connect({ id: "B", label: "B" }, ac.signal)).rejects.toThrow(
      "cancel",
    );
    expect(mocks.listeners.get("connection_data")?.size).toBe(0);
  });
});
