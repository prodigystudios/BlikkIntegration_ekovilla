import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/shared/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/35 disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-950',
        secondary: 'border-ui-border bg-white text-ui-text-strong hover:bg-ui-muted',
        accent: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
      },
      size: {
        sm: 'min-h-9 px-3 text-xs',
        md: 'min-h-10 px-4',
        lg: 'min-h-11 px-4 text-[15px]',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      fullWidth: false,
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export default function Button({ className, variant, size, fullWidth, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size, fullWidth }), className)} {...props} />;
}