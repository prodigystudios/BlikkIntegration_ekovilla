"use client";
import Link from 'next/link';
import type { ReactNode } from 'react';
import Badge from '../ui/Badge';
import { cn } from '@/lib/shared/cn';

export type QuickLink = {
  href: string;
  title: string;
  desc: string;
  icon: ReactNode;
  disabled?: boolean;
  disabledNote?: string; // optional small badge text e.g. 'Kommer snart'
};

function DisabledBadge({ note }: { note?: string }) {
  return (
    <Badge
      className="border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600"
      variant="neutral"
    >
      {note || 'Kommer snart'}
    </Badge>
  );
}

function QuickLinkInner({
  link,
  className,
  iconClassName,
  titleClassName,
  descClassName,
  showDescription,
}: {
  link: QuickLink;
  className: string;
  iconClassName: string;
  titleClassName: string;
  descClassName?: string;
  showDescription?: boolean;
}) {
  return (
    <div className={className} aria-disabled={link.disabled || undefined}>
      <span className={iconClassName}>{link.icon}</span>
      <div className={titleClassName}>{link.title}</div>
      {showDescription ? <div className={descClassName}>{link.desc}</div> : null}
      {link.disabled ? <DisabledBadge note={link.disabledNote} /> : null}
    </div>
  );
}

export function QuickLinksGrid({ links, compact, extraCompact }: { links: QuickLink[]; compact?: boolean; extraCompact?: boolean }) {
  return (
    <div
      className={cn(
        'grid items-start gap-3',
        extraCompact
          ? '[grid-template-columns:repeat(auto-fill,minmax(110px,1fr))]'
          : compact
            ? '[grid-template-columns:repeat(auto-fill,minmax(130px,1fr))]'
            : '[grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]'
      )}
    >
      {links.map(link => {
        const isDesktopy = !compact && !extraCompact;
        const content = (
          <QuickLinkInner
            link={link}
            className={cn(
              'flex flex-col items-center justify-start gap-1.5 border-none text-center outline-none',
              extraCompact ? 'p-2.5' : compact ? 'p-3' : 'p-2.5',
              link.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            iconClassName={cn(
              'inline-flex items-center justify-center rounded-xl',
              extraCompact ? 'h-8 w-8' : 'h-9 w-9',
              isDesktopy ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600'
            )}
            titleClassName={cn(
              'text-center font-bold leading-tight tracking-[-0.2px] text-slate-900',
              extraCompact ? 'text-xs' : compact ? 'text-[13px]' : 'text-sm'
            )}
            descClassName="text-center text-xs leading-5 text-slate-500"
            showDescription={isDesktopy}
          />
        );

        // For desktop-sized tiles, wrap with a bordered card to bring back visual affordance
        if (isDesktopy) {
          const wrapper = (
            <div
              className={cn(
                'relative flex flex-col gap-2 rounded-2xl border border-slate-200 bg-[linear-gradient(145deg,#ffffff,#f8fafc)] px-4 pb-[18px] pt-4 text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.05)] outline-none transition-[border-color,box-shadow,transform]',
                link.disabled
                  ? 'cursor-not-allowed opacity-70'
                  : 'cursor-pointer hover:border-indigo-500 hover:shadow-[0_8px_18px_rgba(99,102,241,0.18)]'
              )}
            >
              {content}
            </div>
          );
          if (link.disabled) return <div key={link.href}>{wrapper}</div>;
          return (
            <Link key={link.href} href={link.href} className="no-underline">
              {wrapper}
            </Link>
          );
        }

        // Compact/extra-compact: keep minimal, no outer card
        if (link.disabled) return <div key={link.href}>{content}</div>;
        return (
          <Link key={link.href} href={link.href} className="no-underline">
            {content}
          </Link>
        );
      })}
    </div>
  );
}

// Horizontal scroll strip for mobile (saves vertical space)
export function QuickLinksStrip({ links, compact, extraCompact }: { links: QuickLink[]; compact?: boolean; extraCompact?: boolean }) {
  const tileMin = extraCompact ? 104 : (compact ? 112 : 140);
  return (
    <div
      role="navigation"
      aria-label="Snabba genvägar"
      className="flex gap-2.5 overflow-x-auto pb-1 [scroll-snap-type:x_proximity] [scrollbar-width:thin] [-webkit-overflow-scrolling:touch]"
    >
      {links.map(link => {
        const inner = (
          <QuickLinkInner
            link={link}
            className={cn(
              'flex shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-[10px] py-3 shadow-[0_8px_18px_rgba(15,23,42,0.04)] outline-none',
              extraCompact ? 'px-2 py-2.5' : 'px-[10px] py-3',
              link.disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
            )}
            iconClassName={cn(
              'inline-flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600',
              extraCompact ? 'h-7 w-7' : 'h-8 w-8'
            )}
            titleClassName={cn(
              'text-center font-bold leading-tight tracking-[-0.2px] text-slate-900',
              extraCompact ? 'text-[11.5px]' : 'text-[12.5px]'
            )}
          />
        );
        if (link.disabled) return <div key={link.href}>{inner}</div>;
        return (
          <Link key={link.href} href={link.href} className="no-underline" style={{ minWidth: tileMin }}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}

// Icon-only vertical bar (used when dashboard quick links minimized)
export function QuickLinksIconBar({ links, activeHref }: { links: QuickLink[]; activeHref?: string }) {
  return (
    <nav aria-label="Snabba genvägar" className="flex flex-col gap-2">
      {links.map(l => {
        const disabled = !!l.disabled;
        const inner = (
          <div
            className={cn(
              'relative flex h-14 w-14 items-center justify-center rounded-[14px] border border-slate-200 text-indigo-600 no-underline transition-[border-color,box-shadow,background]',
              activeHref === l.href ? 'bg-[linear-gradient(135deg,#eef2ff,#e0e7ff)]' : 'bg-white',
              disabled
                ? 'cursor-not-allowed opacity-55'
                : 'cursor-pointer hover:border-indigo-500 hover:shadow-[0_4px_10px_rgba(99,102,241,0.25)]'
            )}
            aria-disabled={disabled || undefined}
            title={l.title + (disabled && l.disabledNote ? ` – ${l.disabledNote}` : '')}
          >
            <span className="inline-flex h-[30px] w-[30px] items-center justify-center">{l.icon}</span>
            {disabled && (
              <span className="absolute bottom-1 right-1 rounded-md border border-slate-200 bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-600">✕</span>
            )}
          </div>
        );
        if (disabled) return <div key={l.href}>{inner}</div>;
        return <Link key={l.href} href={l.href} className="no-underline">{inner}</Link>;
      })}
    </nav>
  );
}

export function QuickLinksSidebar({ links }: { links: QuickLink[] }) {
  return (
    <nav aria-label="Snabba genvägar" className="grid gap-2">
      {links.map(link => {
        const content = (
          <div
            className={cn(
              'grid items-center gap-3 rounded-[14px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-3 pb-3 pt-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)] [grid-template-columns:40px_minmax(0,1fr)]',
              link.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
            aria-disabled={link.disabled || undefined}
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              {link.icon}
            </span>
            <span className="grid min-w-0 gap-[3px]">
              <span className="text-[13.5px] font-bold leading-tight tracking-[-0.2px] text-slate-900">{link.title}</span>
              <span className="text-[11.5px] leading-[1.35] text-slate-500">{link.desc}</span>
              {link.disabled ? <DisabledBadge note={link.disabledNote} /> : null}
            </span>
          </div>
        );

        if (link.disabled) return <div key={link.href}>{content}</div>;
        return <Link key={link.href} href={link.href} className="no-underline">{content}</Link>;
      })}
    </nav>
  );
}
