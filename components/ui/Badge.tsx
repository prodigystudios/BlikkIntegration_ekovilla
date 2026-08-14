import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/shared/cn';

// ⚠️ `border-solid` är inte dekoration. Preflight är av (tailwind.config.js), och en <span> har
// ingen kant från webbläsarens standardmall — så `border` ensamt sätter bredd och färg men lämnar
// border-style på `none`, och ramen ritas ALDRIG. Formulärfält ser bortkomna ut på samma sätt men
// klarar sig, eftersom <input> ärver en kantstil från UA-mallen. En <span> gör det inte.
export const badgeVariants = cva('inline-flex items-center rounded-full border border-solid px-2 py-1 text-xs font-bold', {
  variants: {
    variant: {
      neutral: 'border-slate-200 bg-slate-50 text-slate-600',
      info: 'border-indigo-100 bg-indigo-50 text-indigo-700',
      accent: 'border-emerald-200 bg-emerald-50 text-emerald-700',
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