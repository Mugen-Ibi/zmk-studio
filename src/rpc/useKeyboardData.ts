import { useContext, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Request } from "@zmkfirmware/zmk-studio-ts-client";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { PhysicalLayout } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { ConnectionContext } from "./ConnectionContext";
import { LockStateContext } from "./LockStateContext";
import { call_rpc } from "./logging";
type BehaviorMap = Record<number, GetBehaviorDetailsResponse>;

export function useBehaviors(): BehaviorMap {
  const connection = useContext(ConnectionContext);
  const lockState = useContext(LockStateContext);

  const [behaviors, setBehaviors] = useState<BehaviorMap>({});

  useEffect(() => {
    if (
      !connection.conn ||
      lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED
    ) {
      setBehaviors({});
      return;
    }

    async function startRequest() {
      setBehaviors({});

      if (!connection.conn) {
        return;
      }

      const get_behaviors: Request = {
        behaviors: { listAllBehaviors: true },
        requestId: 0,
      };

      const behavior_list = await call_rpc(connection.conn, get_behaviors);
      if (!ignore) {
        const behavior_map: BehaviorMap = {};
        for (const behaviorId of behavior_list.behaviors?.listAllBehaviors
          ?.behaviors || []) {
          if (ignore) {
            break;
          }
          const details_req = {
            behaviors: { getBehaviorDetails: { behaviorId } },
            requestId: 0,
          };
          const behavior_details = await call_rpc(connection.conn, details_req);
          const dets: GetBehaviorDetailsResponse | undefined =
            behavior_details?.behaviors?.getBehaviorDetails;

          if (dets) {
            behavior_map[dets.id] = dets;
          }
        }

        if (!ignore) {
          setBehaviors(behavior_map);
        }
      }
    }

    let ignore = false;
    void startRequest().catch((error) => {
      if (
        !ignore &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        console.error(error);
    });

    return () => {
      ignore = true;
    };
  }, [connection, lockState]);

  return behaviors;
}

export function useLayouts(): [
  PhysicalLayout[] | undefined,
  Dispatch<SetStateAction<PhysicalLayout[] | undefined>>,
  number,
  Dispatch<SetStateAction<number>>,
] {
  const connection = useContext(ConnectionContext);
  const lockState = useContext(LockStateContext);

  const [layouts, setLayouts] = useState<PhysicalLayout[] | undefined>(
    undefined,
  );
  const [selectedPhysicalLayoutIndex, setSelectedPhysicalLayoutIndex] =
    useState<number>(0);

  useEffect(() => {
    if (
      !connection.conn ||
      lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED
    ) {
      setLayouts(undefined);
      return;
    }

    async function startRequest() {
      setLayouts(undefined);

      if (!connection.conn) {
        return;
      }

      const response = await call_rpc(connection.conn, {
        keymap: { getPhysicalLayouts: true },
      });

      if (!ignore) {
        setLayouts(response?.keymap?.getPhysicalLayouts?.layouts);
        setSelectedPhysicalLayoutIndex(
          response?.keymap?.getPhysicalLayouts?.activeLayoutIndex || 0,
        );
      }
    }

    let ignore = false;
    void startRequest().catch((error) => {
      if (
        !ignore &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        console.error(error);
    });

    return () => {
      ignore = true;
    };
  }, [connection, lockState]);

  return [
    layouts,
    setLayouts,
    selectedPhysicalLayoutIndex,
    setSelectedPhysicalLayoutIndex,
  ];
}
