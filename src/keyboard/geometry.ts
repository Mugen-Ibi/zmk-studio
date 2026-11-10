export type Rectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
  r?: number;
  rx?: number;
  ry?: number;
};
export function layoutBounds(positions: Rectangle[]) {
  if (!positions.length) return { x: 0, y: 0, width: 0, height: 0 };
  const points = positions.flatMap((p) => {
    const angle = ((p.r ?? 0) * Math.PI) / 180;
    const cx = p.rx ?? p.x,
      cy = p.ry ?? p.y;
    return [
      [p.x, p.y],
      [p.x + p.width, p.y],
      [p.x, p.y + p.height],
      [p.x + p.width, p.y + p.height],
    ].map(([x, y]) => ({
      x: cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
      y: cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle),
    }));
  });
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
