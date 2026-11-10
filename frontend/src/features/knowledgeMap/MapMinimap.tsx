import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Point, View } from './layout';

const WIDTH = 150;
const HEIGHT = 96;
const PAD = 6;

interface Props {
  points: readonly Point[];
  view: View;
  size: { width: number; height: number };
  onCenter: (point: Point) => void;
}

/** The whole map at a glance. The frame is what the main view shows; pressing moves the main view there. */
export function MapMinimap({ points, view, size, onCenter }: Props) {
  const { t } = useTranslation();
  if (points.length === 0 || !size.width) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const scale = Math.min((WIDTH - 2 * PAD) / Math.max(Math.max(...xs) - left, 1), (HEIGHT - 2 * PAD) / Math.max(Math.max(...ys) - top, 1));
  const toMini = (point: Point) => ({ x: PAD + (point.x - left) * scale, y: PAD + (point.y - top) * scale });
  const corner = toMini({ x: -view.x / view.k, y: -view.y / view.k });
  const go = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onCenter({ x: (event.clientX - box.left - PAD) / scale + left, y: (event.clientY - box.top - PAD) / scale + top });
  };
  return (
    <svg
      data-testid="map-minimap"
      role="img"
      aria-label={t('map.minimap')}
      width={WIDTH}
      height={HEIGHT}
      onPointerDown={go}
      onPointerMove={(event) => {
        if (event.buttons) go(event);
      }}
      className="cursor-pointer touch-none rounded-control border border-line bg-card"
    >
      {points.map((point, index) => {
        const mini = toMini(point);
        return <circle key={index} cx={mini.x} cy={mini.y} r={1.5} className="fill-muted" />;
      })}
      <rect x={corner.x} y={corner.y} width={(size.width / view.k) * scale} height={(size.height / view.k) * scale} rx={2} className="fill-accent-tint stroke-accent" strokeWidth={1} />
    </svg>
  );
}
