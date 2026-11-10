import {
  CSSProperties,
  PropsWithChildren,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { layoutBounds } from "./geometry";
import { Key } from "./Key";

export type KeyPosition = PropsWithChildren<{
  id: string;
  header?: string;
  width: number;
  height: number;
  x: number;
  y: number;
  r?: number;
  rx?: number;
  ry?: number;
}>;

import type { LayoutZoom } from "./layoutZoom";
interface PhysicalLayoutProps {
  positions: Array<KeyPosition>;
  selectedPosition?: number;
  oneU?: number;
  hoverZoom?: boolean;
  zoom?: LayoutZoom;
  onPositionClicked?: (position: number) => void;
}

interface PhysicalLayoutPositionLocation {
  x: number;
  y: number;
  r?: number;
  rx?: number;
  ry?: number;
}

function scalePosition(
  { x, y, r, rx, ry }: PhysicalLayoutPositionLocation,
  oneU: number,
  offset: { x: number; y: number },
): CSSProperties {
  const left = (x - offset.x) * oneU;
  const top = (y - offset.y) * oneU;
  let transformOrigin = undefined;
  let transform = undefined;
  const transformStyle = "preserve-3d";

  if (r) {
    // Use `??` so an explicit rotation origin of 0 is honored; `rx || x`
    // collapsed a legitimate 0 back to the key's own position, pivoting the
    // key around its own corner instead of the layout origin (#97).
    const transformX = ((rx ?? x) - x) * oneU;
    const transformY = ((ry ?? y) - y) * oneU;
    transformOrigin = `${transformX}px ${transformY}px`;
    transform = `rotate(${r}deg)`;
  }

  return {
    top,
    left,
    transformOrigin,
    transform,
    transformStyle,
  };
}

export const PhysicalLayout = ({
  positions,
  selectedPosition,
  oneU = 48,
  onPositionClicked,
  zoom,
  hoverZoom = true,
}: PhysicalLayoutProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const parent = element.parentElement;
    if (!parent) return;

    const calculateScale = () => {
      if (zoom === "auto") {
        const padding = Math.min(window.innerWidth, window.innerHeight) * 0.05; // Padding when in auto mode
        const newScale = Math.min(
          parent.clientWidth / (element.clientWidth + 2 * padding),
          parent.clientHeight / (element.clientHeight + 2 * padding),
        );
        setScale(newScale);
      } else {
        setScale(zoom || 1);
      }
    };

    calculateScale(); // Initial calculation

    const resizeObserver = new ResizeObserver(() => {
      calculateScale();
    });

    resizeObserver.observe(element);
    resizeObserver.observe(parent);

    return () => {
      resizeObserver.disconnect();
    };
  }, [zoom]);

  const bounds = layoutBounds(positions);

  const positionItems = positions.map((p, idx) => (
    <div
      key={p.id}
      className="absolute hover:z-10"
      style={scalePosition(p, oneU, bounds)}
    >
      <div key={p.id} onClick={() => onPositionClicked?.(idx)}>
        <Key
          oneU={oneU}
          hoverZoom={hoverZoom}
          selected={idx === selectedPosition}
          {...p}
        />
      </div>
    </div>
  ));

  return (
    <div
      className="relative"
      style={{
        height: bounds.height * oneU + "px",
        width: bounds.width * oneU + "px",
        transform: `scale(${scale})`,
        transformStyle: "preserve-3d",
      }}
      ref={ref}
      data-hover-zoom={hoverZoom}
    >
      {positionItems}
    </div>
  );
};
