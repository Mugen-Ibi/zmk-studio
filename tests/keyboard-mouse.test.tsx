import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  Request,
  RequestResponse,
  RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client";
import {
  Keymap,
  PhysicalLayout,
  SetLayerBindingResponse,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import Keyboard from "../src/keyboard/Keyboard";
import { ConnectionContext } from "../src/rpc/ConnectionContext";
import { LockStateContext } from "../src/rpc/LockStateContext";
import { UndoRedoContext, DoCallback } from "../src/undoRedo";
import { call_rpc } from "../src/rpc/logging";
import { mouse, keyPress, layer } from "./mouse-metadata";

// An in-memory server at the RpcConnection stream boundary. Requests and
// responses still pass through the shipped client and protobuf codecs.
function device() {
  let saved = Keymap.fromPartial({
    layers: [
      {
        id: 0,
        name: "Base",
        bindings: [{ behaviorId: 7, param1: 0x70004, param2: 0 }],
      },
    ],
    availableLayers: 1,
  });
  let working = structuredClone(saved);
  const requests: Request[] = [];
  const layout = PhysicalLayout.fromPartial({
    name: "Mock Rev3",
    keys: [{ width: 100, height: 100 }],
  });
  const connect = (): RpcConnection => {
    working = structuredClone(saved);
    let responses: ReadableStreamDefaultController<RequestResponse>;
    return {
      label: "Mock only",
      current_request: 0,
      notification_readable: new ReadableStream(),
      request_response_readable: new ReadableStream({
        start(controller) {
          responses = controller;
        },
      }),
      request_writable: new WritableStream({
        write(raw) {
          const req = Request.decode(Request.encode(raw).finish());
          requests.push(req);
          const resp = RequestResponse.fromPartial({
            requestId: req.requestId,
          });
          if (req.behaviors?.listAllBehaviors) {
            resp.behaviors = { listAllBehaviors: { behaviors: [7, 42, 9] } };
          } else if (req.behaviors?.getBehaviorDetails) {
            resp.behaviors = {
              getBehaviorDetails: [keyPress, mouse, layer].find(
                (b) => b.id === req.behaviors!.getBehaviorDetails!.behaviorId,
              ),
            };
          } else if (req.keymap?.getKeymap) {
            resp.keymap = { getKeymap: working };
          } else if (req.keymap?.getPhysicalLayouts) {
            resp.keymap = {
              getPhysicalLayouts: { layouts: [layout], activeLayoutIndex: 0 },
            };
          } else if (req.keymap?.setActivePhysicalLayout !== undefined) {
            resp.keymap = { setActivePhysicalLayout: { ok: working } };
          } else if (req.keymap?.setLayerBinding) {
            const binding = req.keymap.setLayerBinding.binding!;
            // Mirrors the mouse metadata constraint; do not accept fabricated masks.
            const valid =
              binding.behaviorId === 42 &&
              [1, 2, 4, 8, 16].includes(binding.param1) &&
              binding.param2 === 0;
            if (valid) working.layers[0].bindings[0] = binding;
            resp.keymap = {
              setLayerBinding: valid
                ? SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
                : SetLayerBindingResponse.SET_LAYER_BINDING_RESP_INVALID_PARAMETERS,
            };
          } else if (req.keymap?.saveChanges) {
            saved = structuredClone(working);
            resp.keymap = { saveChanges: { ok: true } };
          } else {
            throw new Error(`Unexpected RPC: ${JSON.stringify(req)}`);
          }
          responses.enqueue(
            RequestResponse.decode(RequestResponse.encode(resp).finish()),
          );
        },
      }),
    };
  };
  return { connect, requests };
}

const doIt = async (callback: DoCallback) => {
  await callback();
};
function connected(conn: RpcConnection | null) {
  return (
    <ConnectionContext.Provider value={{ conn }}>
      <LockStateContext.Provider
        value={LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED}
      >
        <UndoRedoContext.Provider value={doIt}>
          <Keyboard />
        </UndoRedoContext.Provider>
      </LockStateContext.Provider>
    </ConnectionContext.Provider>
  );
}

it("fetches metadata, edits and saves each of MB1–MB5, then reloads each from a new connection", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const mock = device();
  let conn = mock.connect();
  const view = render(connected(conn));
  fireEvent.click(await screen.findByRole("button", { name: "A" }));
  const selects = screen.getAllByRole("combobox");
  const behaviorSelect = selects.find((s) =>
    Array.from((s as HTMLSelectElement).options).some(
      (o) => o.text === "Mouse Key Press",
    ),
  )!;
  fireEvent.change(behaviorSelect, { target: { value: "42" } });
  expect(mock.requests.filter((r) => r.keymap?.setLayerBinding)).toHaveLength(
    0,
  );
  for (const [i, value] of [1, 2, 4, 8, 16].entries()) {
    const option = screen.getByRole("option", { name: `MB${i + 1}` });
    fireEvent.change(option.parentElement!, {
      target: { value: String(value) },
    });
    await screen.findByRole("button", { name: new RegExp(`MB${i + 1}`) });
    const saveResponse = await call_rpc(conn, {
      keymap: { saveChanges: true },
    });
    expect(saveResponse.keymap?.saveChanges?.ok).toBe(true);
    view.rerender(connected(null));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /MB[1-5]/ })).toBeNull(),
    );
    conn = mock.connect();
    view.rerender(connected(conn));
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(`MB${i + 1}`) }),
    );
    expect(
      (screen.getByRole("option", { name: `MB${i + 1}` }) as HTMLOptionElement)
        .selected,
    ).toBe(true);
  }
  const edits = mock.requests.flatMap((r) =>
    r.keymap?.setLayerBinding ? [r.keymap.setLayerBinding.binding!.param1] : [],
  );
  expect(edits).toEqual([1, 2, 4, 8, 16]);
  expect(
    mock.requests.filter(
      (r) => r.behaviors?.getBehaviorDetails?.behaviorId === 42,
    ),
  ).toHaveLength(6);
  expect(mock.requests.filter((r) => r.keymap?.setLayerBinding)).toHaveLength(
    5,
  );
  vi.unstubAllGlobals();
});
