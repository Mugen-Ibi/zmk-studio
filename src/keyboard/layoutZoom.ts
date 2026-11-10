export type LayoutZoom = number | "auto";

export function deserializeLayoutZoom(value: string): LayoutZoom {
  if (value === "auto") {
    return "auto";
  }
  const zoom = Number(value);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : "auto";
}
