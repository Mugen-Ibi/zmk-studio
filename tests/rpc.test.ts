import { describe, expect, it } from "vitest";
import { createConnection } from "../src/rpc/connection";
import { call_rpc, RpcTimeoutError } from "../src/rpc/logging";
import { fakeDevice } from "./fake-device";

describe("real framed RPC sessions", () => {
  it("ends unanswered A and sends B's handshake, with no shared mutex", async () => {
    const a = fakeDevice("A");
    a.fail.silent = true;
    const ac = new AbortController();
    const ca = createConnection(a.transport, ac);
    const pending = call_rpc(ca, { core: { getDeviceInfo: true } }, 30);
    const b = fakeDevice("B");
    const bc = new AbortController();
    const cb = createConnection(b.transport, bc);
    expect(
      (await call_rpc(cb, { core: { getDeviceInfo: true } })).core
        ?.getDeviceInfo?.name,
    ).toBe("B");
    await expect(pending).rejects.toBeInstanceOf(RpcTimeoutError);
    expect(ac.signal.aborted).toBe(true);
    expect(a.transport.abortController.signal.aborted).toBe(true);
    expect(
      (await call_rpc(cb, { core: { getDeviceInfo: true } })).core
        ?.getDeviceInfo?.name,
    ).toBe("B");
    expect(b.requests).toHaveLength(2);
    bc.abort();
  });
  it("serializes requests and rejects queued work after disconnect", async () => {
    const device = fakeDevice();
    const ac = new AbortController();
    const conn = createConnection(device.transport, ac);
    await Promise.all([
      call_rpc(conn, { core: { getDeviceInfo: true } }),
      call_rpc(conn, { core: { getLockState: true } }),
    ]);
    expect(device.requests.map((r) => r.requestId)).toEqual([0, 1]);
    device.fail.silent = true;
    const one = call_rpc(conn, { keymap: { getKeymap: true } });
    const two = call_rpc(conn, { keymap: { getKeymap: true } });
    ac.abort(new Error("Disconnected"));
    await expect(one).rejects.toThrow("Disconnected");
    await expect(two).rejects.toThrow("Disconnected");
  });
  it("stream termination rejects an active RPC", async () => {
    const device = fakeDevice();
    device.fail.silent = true;
    const conn = createConnection(device.transport, new AbortController());
    const result = call_rpc(conn, { core: { getDeviceInfo: true } });
    device.end();
    await expect(result).rejects.toThrow();
    expect(device.transport.abortController.signal.aborted).toBe(true);
  });
});
