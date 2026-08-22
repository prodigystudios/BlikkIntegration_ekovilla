import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/shared/cn';

export const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-1 text-xs font-bold', {
  variants: {
    variant: {
      neutral: 'border-slate-200 bg-slate-50 text-slate-600',
      info: 'border-indigo-100 bg-indigo-50 text-indigo-700',
      // Framhävning, inte status: den här varianten bär sektionsetiketter, "Idag" och
      // antalsmarkörer, medan statusgrönt bor i crmTokens statuskartor.
      // ⚠️ Ett undantag: ArticlesClient använder accent för "Aktiv"/"Inaktiv", alltså som
      // status. Äldre missmatch — det saknas en success-variant här.
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