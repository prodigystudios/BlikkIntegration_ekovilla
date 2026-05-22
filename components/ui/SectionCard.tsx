import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

type SectionCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export default function SectionCard({ className, children, ...props }: SectionCardProps) {
  return (
    <div
      className={cn('rounded-card border border-ui-border bg-ui-surface shadow-soft', className)}
      {...props}
    >
      {children}
    </div>
  );
}