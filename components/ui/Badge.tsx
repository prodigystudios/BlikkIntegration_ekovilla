import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/shared/cn';

export const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-1 text-xs font-bold', {
  variants: {
    variant: {
      neutral: 'border-slate-200 bg-slate-50 text-slate-600',
      info: 'border-indigo-100 bg-indigo-50 text-indigo-700',
      // Framhavning, inte status. Statusgront bor i crmTokens statuskartor — den har
      // varianten bar sektionsetiketter, "Idag" och antalsmarkorer.
      accent: 'border-[color:var(--ek-accent-soft-border)] bg-[color:var(--ek-accent-soft)] text-[color:var(--ek-accent)]',
      danger: 'border-red-200 bg-red-50 text-red-800',
    },
  },
  defaultVariants: {
    variant: 'neutral',
  },
});

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export default function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}