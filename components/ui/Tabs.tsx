import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

function focusRelativeTab(currentTab: HTMLElement, direction: 'next' | 'previous' | 'first' | 'last') {
  const tabList = currentTab.closest('[role="tablist"]');
  if (!tabList) return;

  const tabs = Array.from(tabList.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (tabs.length === 0) return;

  const currentIndex = tabs.indexOf(currentTab);
  if (currentIndex === -1) return;

  if (direction === 'first') {
    tabs[0]?.focus();
    return;
  }

  if (direction === 'last') {
    tabs.at(-1)?.focus();
    return;
  }

  const offset = direction === 'next' ? 1 : -1;
  const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
}

type TabsProps = HTMLAttributes<HTMLDivElement>;

export function Tabs({ className, ...props }: TabsProps) {
  return <div className={cn('grid gap-4', className)} {...props} />;
}

type TabsListProps = HTMLAttributes<HTMLDivElement>;

export function TabsList({ className, ...props }: TabsListProps) {
  return <div role="tablist" aria-orientation="horizontal" className={cn('flex flex-wrap gap-2', className)} {...props} />;
}

type TabsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  variant?: 'card' | 'pill';
  children: ReactNode;
};

export function TabsTrigger({ className, active = false, variant = 'pill', children, type, ...props }: TabsTriggerProps) {
  return (
    <button
      type={type ?? 'button'}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);

        if (event.defaultPrevented) return;

        const currentTarget = event.currentTarget;

        switch (event.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            event.preventDefault();
            focusRelativeTab(currentTarget, 'next');
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            event.preventDefault();
            focusRelativeTab(currentTarget, 'previous');
            break;
          case 'Home':
            event.preventDefault();
            focusRelativeTab(currentTarget, 'first');
            break;
          case 'End':
            event.preventDefault();
            focusRelativeTab(currentTarget, 'last');
            break;
          default:
            break;
        }
      }}
      className={cn(
        'rounded-2xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20',
        variant === 'card' && 'grid justify-start gap-1 px-3.5 py-3 text-left text-slate-900',
        variant === 'pill' && 'inline-flex min-h-10 items-center justify-center px-3.5 text-sm font-semibold',
        variant === 'card' && active && 'border-emerald-200 bg-[linear-gradient(180deg,#f3f9f1_0%,#e0e8dc_100%)] shadow-[0_10px_24px_rgba(20,44,27,0.12)] hover:border-emerald-300 hover:bg-[linear-gradient(180deg,#f3f9f1_0%,#e0e8dc_100%)]',
        variant === 'card' && !active && 'border-[#e0e8dc] bg-white hover:border-emerald-200 hover:bg-[#f9fbf7]',
        variant === 'pill' && active && 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_8px_20px_rgba(20,44,27,0.08)] hover:border-emerald-300 hover:bg-emerald-50',
        variant === 'pill' && !active && 'border-[#e0e8dc] bg-white text-slate-700 hover:border-emerald-200 hover:bg-[#f9fbf7]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}