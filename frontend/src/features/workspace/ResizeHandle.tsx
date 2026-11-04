import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  onReset: () => void;
}

const KEY_STEP = 24;

/** Drag, double-click or arrow keys. The handle sits on the left edge of the right pane. */
export function ResizeHandle({ width, min, max, onChange, onReset }: Props) {
  const { t } = useTranslation();
  const start = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current) onChange(clamp(start.current.width + start.current.x - event.clientX));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') onChange(clamp(width + KEY_STEP));
    else if (event.key === 'ArrowRight') onChange(clamp(width - KEY_STEP));
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('workspace.resize')}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-offset-[-2px]"
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-line transition-colors duration-150 group-hover:bg-accent group-active:bg-accent" />
    </div>
  );
}
