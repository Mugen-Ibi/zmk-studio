import {
  SetStateAction,
  Dispatch,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ConnectionContext } from "./ConnectionContext";
import { call_rpc } from "./logging";
import { Request, RequestResponse } from "@zmkfirmware/zmk-studio-ts-client";
import { LockStateContext } from "./LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";

export function useConnectedDeviceData<T>(
  req: Omit<Request, "requestId">,
  response_mapper: (resp: RequestResponse) => T | undefined,
  requireUnlock?: boolean,
): [T | undefined, Dispatch<SetStateAction<T | undefined>>] {
  const connection = useContext(ConnectionContext);
  const lockState = useContext(LockStateContext);
  const [data, setData] = useState<T>();
  const mapper = useRef(response_mapper);
  mapper.current = response_mapper;
  const requestKey = JSON.stringify(req);
  const allowed =
    !requireUnlock ||
    lockState === LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED;
  useEffect(() => {
    setData(undefined);
    if (!connection.conn || !allowed) return;
    let ignore = false;
    void call_rpc(connection.conn, JSON.parse(requestKey))
      .then((response) => {
        if (!ignore) setData(mapper.current(response));
      })
      .catch((error) => {
        if (
          !ignore &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          console.error(error);
      });
    return () => {
      ignore = true;
    };
  }, [connection, allowed, requestKey]);
  return [data, setData];
}
