import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/shared/cn';

type PageShellProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

// Centering/max-width wrapper for full-page content. Renders a plain <div> — the
// app shell already provides the page <main> and its padding, so nesting another
// <main> here would be invalid and double-pad the content.
export default function PageShell({ className, children, ...props }: PageShellProps) {
  return (
    <div
      className={cn(
        'mx-auto box-border flex w-full max-w-[1680px] flex-col gap-4 text-ui-text-strong',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}