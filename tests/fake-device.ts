import {
  Request,
  Response,
  RequestResponse,
} from "@zmkfirmware/zmk-studio-ts-client";
import {
  Keymap,
  PhysicalLayout,
  SetLayerBindingResponse,
  SetLayerPropsResponse,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { get_decoder } from "@zmkfirmware/zmk-studio-ts-client/framing";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { keyPress, mouse, layer } from "./mouse-metadata";

export function frame(message: Response) {
  const bytes = Response.encode(message).finish();
  return new Uint8Array([
    0xab,
    ...Array.from(bytes).flatMap((b) =>
      b >= 0xab && b <= 0xad ? [0xac, b] : [b],
    ),
    0xad,
  ]);
}
export function fakeDevice(name = "Test keyboard") {
  let saved = Keymap.fromPartial({
    availableLayers: 2,
    layers: [0, 3].map((id, i) => ({
      id,
      name: i ? "Fn" : "Base",
      bindings: [{ behaviorId: 7, param1: 0x70004, param2: 0 }],
    })),
  });
  let working = structuredClone(saved);
  let activeLayout = 0;
  let unsaved = false;
  const layouts = ["Standard", "Alternative"].map((name) =>
    PhysicalLayout.fromPartial({ name, keys: [{ width: 100, height: 100 }] }),
  );
  const requests: Request[] = [];
  const fail = {
    save: false,
    discard: false,
    reset: false,
    layout: false,
    binding: false,
    silent: false,
  };
  let output: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  const abortController = new AbortController();
  const send = (message: Response) => {
    if (!ended) output.enqueue(frame(message));
  };
  const end = () => {
    if (!ended) {
      ended = true;
      output.close();
    }
  };
  const notifyUnsaved = () =>
    send({
      notification: { keymap: { unsavedChangesStatusChanged: unsaved } },
    });
  const respond = async (bytes: Uint8Array) => {
    const req = Request.decode(bytes);
    requests.push(req);
    if (fail.silent) return;
    const resp = RequestResponse.fromPartial({ requestId: req.requestId });
    if (req.core?.getDeviceInfo)
      resp.core = { getDeviceInfo: { name, serialNumber: new Uint8Array() } };
    else if (req.core?.getLockState)
      resp.core = {
        getLockState: LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED,
      };
    else if (req.core?.resetSettings)
      resp.core = { resetSettings: !fail.reset };
    else if (req.behaviors?.listAllBehaviors)
      resp.behaviors = { listAllBehaviors: { behaviors: [7, 42, 9] } };
    else if (req.behaviors?.getBehaviorDetails)
      resp.behaviors = {
        getBehaviorDetails: [keyPress, mouse, layer].find(
          (b) => b.id === req.behaviors!.getBehaviorDetails!.behaviorId,
        ),
      };
    else if (req.keymap?.getKeymap) resp.keymap = { getKeymap: working };
    else if (req.keymap?.getPhysicalLayouts)
      resp.keymap = {
        getPhysicalLayouts: { layouts, activeLayoutIndex: activeLayout },
      };
    else if (req.keymap?.checkUnsavedChanges)
      resp.keymap = { checkUnsavedChanges: unsaved };
    else if (req.keymap?.setActivePhysicalLayout !== undefined) {
      if (!fail.layout) activeLayout = req.keymap.setActivePhysicalLayout;
      resp.keymap = {
        setActivePhysicalLayout: fail.layout ? {} : { ok: working },
      };
    } else if (req.keymap?.setLayerBinding) {
      const { layerId, keyPosition, binding } = req.keymap.setLayerBinding;
      if (!fail.binding) {
        working.layers.find((l) => l.id === layerId)!.bindings[keyPosition] =
          binding!;
        unsaved = true;
      }
      resp.keymap = {
        setLayerBinding: fail.binding
          ? SetLayerBindingResponse.SET_LAYER_BINDING_RESP_INVALID_PARAMETERS
          : SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK,
      };
    } else if (req.keymap?.setLayerProps) {
      const { layerId, name } = req.keymap.setLayerProps;
      working.layers.find((l) => l.id === layerId)!.name = name;
      resp.keymap = {
        setLayerProps: SetLayerPropsResponse.SET_LAYER_PROPS_RESP_OK,
      };
    } else if (req.keymap?.removeLayer) {
      working.layers.splice(req.keymap.removeLayer.layerIndex, 1);
      resp.keymap = { removeLayer: { ok: true } };
    } else if (req.keymap?.moveLayer) {
      const { startIndex, destIndex } = req.keymap.moveLayer;
      working.layers.splice(
        destIndex,
        0,
        ...working.layers.splice(startIndex, 1),
      );
      resp.keymap = { moveLayer: { ok: working } };
    } else if (req.keymap?.saveChanges) {
      if (!fail.save) {
        saved = structuredClone(working);
        unsaved = false;
      }
      resp.keymap = { saveChanges: fail.save ? {} : { ok: true } };
    } else if (req.keymap?.discardChanges) {
      if (!fail.discard) {
        working = structuredClone(saved);
        unsaved = false;
      }
      resp.keymap = { discardChanges: !fail.discard };
    } else throw new Error("Unhandled fake request: " + JSON.stringify(req));
    send({ requestResponse: resp });
    notifyUnsaved();
  };
  const decoder = new TransformStream(get_decoder());
  void decoder.readable
    .pipeTo(new WritableStream({ write: respond }), {
      signal: abortController.signal,
    })
    .catch(() => {});
  const writer = decoder.writable.getWriter();
  const transport: RpcTransport = {
    label: name,
    abortController,
    readable: new ReadableStream({
      start(c) {
        output = c;
      },
      cancel() {
        ended = true;
      },
    }),
    writable: new WritableStream({
      write: (bytes) => writer.write(bytes),
      abort: (reason) => writer.abort(reason),
      close: () => writer.close(),
    }),
  };
  abortController.signal.addEventListener("abort", end, { once: true });
  return {
    transport,
    requests,
    fail,
    end,
    send,
    get saved() {
      return saved;
    },
    get working() {
      return working;
    },
    get activeLayout() {
      return activeLayout;
    },
  };
}
