import type { TransportFactory } from "../ConnectModal";
import { abortable } from "../misc/abortable";
export async function enumerateDevices(transports: TransportFactory[]) {
  const results = await Promise.allSettled(
    transports.map(async (transport) => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error("Device discovery timed out")),
        8000,
      );
      try {
        return {
          transport,
          devices: await abortable(
            transport.pick_and_connect?.list() ?? Promise.resolve([]),
            controller.signal,
          ),
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return {
    devices: results.flatMap((r) =>
      r.status === "fulfilled"
        ? r.value.devices.map((device) => ({
            transport: r.value.transport,
            device,
          }))
        : [],
    ),
    errors: results.flatMap((r, i) =>
      r.status === "rejected"
        ? [
            `${transports[i].label}: ${r.reason instanceof Error ? r.reason.message : JSON.stringify(r.reason)}`,
          ]
        : [],
    ),
  };
}
