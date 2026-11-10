import { invoke } from "@tauri-apps/api/core";
import type { AvailableDevice } from ".";
import { connectNative } from "./transport";
export const list_devices = () =>
  invoke<AvailableDevice[]>("gatt_list_devices");
export const connect = (dev: AvailableDevice, signal?: AbortSignal) =>
  connectNative("gatt_connect", dev, signal);
