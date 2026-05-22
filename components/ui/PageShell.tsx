import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/shared/cn';

type PageShellProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export default function PageShell({ className, children, ...props }: PageShellProps) {
  return (
    <main
      className={cn(
        'mx-auto box-border flex w-full max-w-[1680px] flex-col gap-4 px-4 py-4 text-ui-text-strong sm:px-5 lg:px-6',
        className,
      )}
      {...props}
    >
      {children}
    </main>
  );
}