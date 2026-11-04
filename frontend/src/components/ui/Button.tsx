import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong',
  secondary: 'bg-card border border-line text-fg hover:border-line-strong hover:bg-card-raised',
  ghost: 'text-muted hover:text-fg hover:bg-hover',
  danger: 'bg-danger-tint border border-danger/40 text-danger hover:bg-danger/20',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-2 rounded-[10px]',
  md: 'h-9 px-3 text-sm gap-2 rounded-control',
  lg: 'h-10 px-4 text-base gap-2 rounded-control',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return cn(
    'pressable inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium select-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
  );
}

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size), className)}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
