import {
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { call_rpc } from "../rpc/logging";
import {
  Keymap,
  SetLayerBindingResponse,
  SetLayerPropsResponse,
  BehaviorBinding,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";

import { LayerPicker } from "./LayerPicker";
import { PhysicalLayoutPicker } from "./PhysicalLayoutPicker";
import { Keymap as KeymapComp } from "./Keymap";
import { useConnectedDeviceData } from "../rpc/useConnectedDeviceData";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { UndoRedoContext } from "../undoRedo";
import { BehaviorBindingPicker } from "../behaviors/BehaviorBindingPicker";
import { produce } from "immer";
import { deserializeLayoutZoom, LayoutZoom } from "./layoutZoom";
import { useLocalStorageState } from "../misc/useLocalStorageState";

import { useBehaviors, useLayouts } from "../rpc/useKeyboardData";

export default function Keyboard() {
  const [
    layouts,
    ,
    selectedPhysicalLayoutIndex,
    setSelectedPhysicalLayoutIndex,
  ] = useLayouts();
  const [keymap, setKeymapState] = useConnectedDeviceData<Keymap>(
    { keymap: { getKeymap: true } },
    (keymap) => {
      return keymap?.keymap?.getKeymap;
    },
    true,
  );

  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const layoutIndexRef = useRef(selectedPhysicalLayoutIndex);
  layoutIndexRef.current = selectedPhysicalLayoutIndex;
  const setKeymap = useCallback(
    (next: SetStateAction<Keymap | undefined>) => {
      const value = typeof next === "function" ? next(keymapRef.current) : next;
      keymapRef.current = value;
      setKeymapState(value);
    },
    [setKeymapState],
  );

  const [keymapScale, setKeymapScale] = useLocalStorageState<LayoutZoom>(
    "keymapScale",
    "auto",
    {
      deserialize: deserializeLayoutZoom,
    },
  );

  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(0);
  const [selectedKeyPosition, setSelectedKeyPosition] = useState<
    number | undefined
  >(undefined);
  const behaviors = useBehaviors();

  const conn = useContext(ConnectionContext);
  const undoRedo = useContext(UndoRedoContext);

  useEffect(() => {
    setSelectedLayerIndex(0);
    setSelectedKeyPosition(undefined);
  }, [conn]);

  const doSelectPhysicalLayout = useCallback(
    (index: number) => {
      const select = async (i: number) => {
        if (!conn.conn) throw new Error("Not connected");
        const response = await call_rpc(conn.conn, {
          keymap: { setActivePhysicalLayout: i },
        });
        const next = response.keymap?.setActivePhysicalLayout?.ok;
        if (!next) throw new Error("The device rejected the physical layout");
        setKeymap(next);
        layoutIndexRef.current = i;
        setSelectedPhysicalLayoutIndex(i);
      };
      return undoRedo?.(async () => {
        const oldIndex = layoutIndexRef.current;
        await select(index);
        return () => select(oldIndex);
      });
    },
    [conn, undoRedo, setKeymap, setSelectedPhysicalLayoutIndex],
  );

  const doUpdateBinding = useCallback(
    (binding: BehaviorBinding) => {
      if (!keymap || selectedKeyPosition === undefined) {
        console.error(
          "Can't update binding without a selected key position and loaded keymap",
        );
        return;
      }

      const layerId = keymap.layers[selectedLayerIndex].id;
      const keyPosition = selectedKeyPosition;
      return undoRedo?.(async () => {
        const oldBinding = keymapRef.current?.layers.find(
          (l) => l.id === layerId,
        )?.bindings[keyPosition];
        if (!oldBinding)
          throw new Error("The selected binding is no longer available");
        if (!conn.conn) {
          throw new Error("Not connected");
        }

        const resp = await call_rpc(conn.conn, {
          keymap: { setLayerBinding: { layerId, keyPosition, binding } },
        });

        if (
          resp.keymap?.setLayerBinding ===
          SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
        ) {
          setKeymap(
            produce((draft: Keymap | undefined) => {
              if (!draft) return;
              draft.layers.find((l) => l.id === layerId)!.bindings[
                keyPosition
              ] = binding;
            }),
          );
        } else {
          throw new Error("The device rejected the binding");
        }

        return async () => {
          if (!conn.conn) {
            return;
          }

          const resp = await call_rpc(conn.conn, {
            keymap: {
              setLayerBinding: { layerId, keyPosition, binding: oldBinding },
            },
          });
          if (
            resp.keymap?.setLayerBinding ===
            SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK
          ) {
            setKeymap(
              produce((draft: Keymap | undefined) => {
                if (!draft) return;
                draft.layers.find((l) => l.id === layerId)!.bindings[
                  keyPosition
                ] = oldBinding;
              }),
            );
          } else {
            throw new Error("The device rejected undoing the binding");
          }
        };
      });
    },
    [
      conn,
      keymap,
      undoRedo,
      selectedLayerIndex,
      selectedKeyPosition,
      setKeymap,
    ],
  );

  const selectedBinding = useMemo(() => {
    if (
      keymap == null ||
      selectedKeyPosition == null ||
      !keymap.layers[selectedLayerIndex]
    ) {
      return null;
    }

    return keymap.layers[selectedLayerIndex].bindings[selectedKeyPosition];
  }, [keymap, selectedLayerIndex, selectedKeyPosition]);

  const moveLayer = useCallback(
    (start: number, end: number) => {
      const doMove = async (startIndex: number, destIndex: number) => {
        if (!conn.conn) {
          return;
        }

        const resp = await call_rpc(conn.conn, {
          keymap: { moveLayer: { startIndex, destIndex } },
        });

        if (resp.keymap?.moveLayer?.ok) {
          setKeymap(resp.keymap?.moveLayer?.ok);
          setSelectedLayerIndex(destIndex);
        } else {
          throw new Error("The device rejected moving the layer");
        }
      };

      undoRedo?.(async () => {
        await doMove(start, end);
        return () => doMove(end, start);
      });
    },
    [undoRedo, conn, setKeymap],
  );

  const addLayer = useCallback(() => {
    async function doAdd(): Promise<number> {
      if (!conn.conn || !keymap) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, { keymap: { addLayer: {} } });

      if (resp.keymap?.addLayer?.ok) {
        const newSelection = keymap.layers.length;
        setKeymap(
          produce((draft: Keymap | undefined) => {
            if (!draft) return;
            draft.layers.push(resp.keymap!.addLayer!.ok!.layer!);
            draft.availableLayers--;
          }),
        );

        setSelectedLayerIndex(newSelection);

        return resp.keymap.addLayer.ok.index;
      } else {
        console.error("Add error", resp.keymap?.addLayer?.err);
        throw new Error("Failed to add layer:" + resp.keymap?.addLayer?.err);
      }
    }

    async function doRemove(layerIndex: number) {
      if (!conn.conn) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { removeLayer: { layerIndex } },
      });

      console.log(resp);
      if (resp.keymap?.removeLayer?.ok) {
        setKeymap(
          produce((draft: Keymap | undefined) => {
            if (!draft) return;
            draft.layers.splice(layerIndex, 1);
            draft.availableLayers++;
          }),
        );
      } else {
        console.error("Remove error", resp.keymap?.removeLayer?.err);
        throw new Error(
          "Failed to remove layer:" + resp.keymap?.removeLayer?.err,
        );
      }
    }

    undoRedo?.(async () => {
      const index = await doAdd();
      return () => doRemove(index);
    });
  }, [conn, undoRedo, keymap, setKeymap]);

  const removeLayer = useCallback(() => {
    async function doRemove(layerIndex: number): Promise<void> {
      if (!conn.conn || !keymap) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { removeLayer: { layerIndex } },
      });

      if (resp.keymap?.removeLayer?.ok) {
        if (layerIndex == keymap.layers.length - 1) {
          setSelectedLayerIndex(layerIndex - 1);
        }
        setKeymap(
          produce((draft: Keymap | undefined) => {
            if (!draft) return;
            draft.layers.splice(layerIndex, 1);
            draft.availableLayers++;
          }),
        );
      } else {
        console.error("Remove error", resp.keymap?.removeLayer?.err);
        throw new Error(
          "Failed to remove layer:" + resp.keymap?.removeLayer?.err,
        );
      }
    }

    async function doRestore(layerId: number, atIndex: number) {
      if (!conn.conn) {
        throw new Error("Not connected");
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { restoreLayer: { layerId, atIndex } },
      });

      console.log(resp);
      if (resp.keymap?.restoreLayer?.ok) {
        setKeymap(
          produce((draft: Keymap | undefined) => {
            if (!draft) return;
            draft.layers.splice(atIndex, 0, resp!.keymap!.restoreLayer!.ok!);
            draft.availableLayers--;
          }),
        );
        setSelectedLayerIndex(atIndex);
      } else {
        console.error("Remove error", resp.keymap?.restoreLayer?.err);
        throw new Error(
          "Failed to restore layer:" + resp.keymap?.restoreLayer?.err,
        );
      }
    }

    if (!keymap) {
      throw new Error("No keymap loaded");
    }

    const index = selectedLayerIndex;
    const layerId = keymap.layers[index].id;
    undoRedo?.(async () => {
      await doRemove(index);
      return () => doRestore(layerId, index);
    });
  }, [conn, undoRedo, selectedLayerIndex, keymap, setKeymap]);

  const changeLayerName = useCallback(
    (id: number, oldName: string, newName: string) => {
      async function changeName(layerId: number, name: string) {
        if (!conn.conn) {
          throw new Error("Not connected");
        }

        const resp = await call_rpc(conn.conn, {
          keymap: { setLayerProps: { layerId, name } },
        });

        if (
          resp.keymap?.setLayerProps ==
          SetLayerPropsResponse.SET_LAYER_PROPS_RESP_OK
        ) {
          setKeymap(
            produce((draft: Keymap | undefined) => {
              if (!draft) return;
              const layer_index = draft.layers.findIndex(
                (l) => l.id == layerId,
              );
              draft.layers[layer_index].name = name;
            }),
          );
        } else {
          throw new Error(
            "Failed to change layer name:" + resp.keymap?.setLayerProps,
          );
        }
      }

      undoRedo?.(async () => {
        await changeName(id, newName);
        return async () => {
          await changeName(id, oldName);
        };
      });
    },
    [conn, undoRedo, setKeymap],
  );

  useEffect(() => {
    if (!keymap?.layers) return;

    const layers = keymap.layers.length - 1;

    if (selectedLayerIndex > layers) {
      setSelectedLayerIndex(layers);
    }
  }, [keymap, selectedLayerIndex]);

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(10em,auto)] bg-base-300 max-w-full min-w-0 min-h-0">
      <div className="p-2 flex flex-col gap-2 bg-base-200 sm:row-span-2 overflow-auto">
        {layouts && (
          <div className="col-start-3 row-start-1 row-end-2">
            <PhysicalLayoutPicker
              layouts={layouts}
              selectedPhysicalLayoutIndex={selectedPhysicalLayoutIndex}
              onPhysicalLayoutClicked={doSelectPhysicalLayout}
            />
          </div>
        )}

        {keymap && (
          <div className="col-start-1 row-start-1 row-end-2">
            <LayerPicker
              layers={keymap.layers}
              selectedLayerIndex={selectedLayerIndex}
              onLayerClicked={setSelectedLayerIndex}
              onLayerMoved={moveLayer}
              canAdd={(keymap.availableLayers || 0) > 0}
              canRemove={(keymap.layers?.length || 0) > 1}
              onAddClicked={addLayer}
              onRemoveClicked={removeLayer}
              onLayerNameChanged={changeLayerName}
            />
          </div>
        )}
      </div>
      {layouts && keymap && behaviors && (
        <div className="p-2 col-start-2 row-start-1 grid items-center justify-center relative min-w-0">
          <KeymapComp
            keymap={keymap}
            layout={layouts[selectedPhysicalLayoutIndex]}
            behaviors={behaviors}
            scale={keymapScale}
            selectedLayerIndex={selectedLayerIndex}
            selectedKeyPosition={selectedKeyPosition}
            onKeyPositionClicked={setSelectedKeyPosition}
          />
          <select
            aria-label="Keyboard zoom"
            className="absolute top-2 right-2 h-8 rounded px-2"
            value={keymapScale}
            onChange={(e) => {
              const value = deserializeLayoutZoom(e.target.value);
              setKeymapScale(value);
            }}
          >
            <option value="auto">Auto</option>
            <option value={0.25}>25%</option>
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </div>
      )}
      {keymap && selectedBinding && (
        <div className="p-2 col-span-2 sm:col-span-1 sm:col-start-2 row-start-2 bg-base-200 min-w-0 max-h-[45vh] overflow-auto">
          <BehaviorBindingPicker
            binding={selectedBinding}
            behaviors={Object.values(behaviors)}
            layers={keymap.layers.map(({ id, name }, li) => ({
              id,
              name: name || li.toLocaleString(),
            }))}
            onBindingChanged={doUpdateBinding}
          />
        </div>
      )}
    </div>
  );
}
