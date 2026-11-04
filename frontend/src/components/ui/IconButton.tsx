import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface IconButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'aria-label'> {
  label: string;
  icon: ReactNode;
  active?: boolean;
  /** Stays 32px on touch screens, for toolbars that must fit a 360px phone. */
  dense?: boolean;
}

/** Icon-only button. The label is required so it always has an accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active = false, dense = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'pressable inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-muted',
        'hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        !dense && 'pointer-coarse:size-11',
        active && 'bg-accent-tint text-fg',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
