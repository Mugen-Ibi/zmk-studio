/** Firmware accepts the final index after the source has been removed. */
export function dropDestination(
  start: number,
  target: number,
  position: "before" | "after" | "on",
) {
  const insertion = target + (position === "after" ? 1 : 0);
  return insertion - (start < insertion ? 1 : 0);
}
