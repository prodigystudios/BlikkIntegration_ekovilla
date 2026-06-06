"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import type { UserRole } from '@/lib/roles';
import { getVisibleCrmNavItems, type CrmNavItem } from '../_lib/nav';

// True when the current path is at or below the given nav href.
function isHrefActive(href: string, pathname: string) {
  if (href === '/crm') return pathname === '/crm';
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The most specific child whose href matches the current path, so /installningar
// (Översikt) isn't also marked active while on /installningar/artiklar.
function activeChildHref(children: CrmNavItem[], pathname: string): string | null {
  const matches = children
    .filter((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

const navIcons: Record<string, JSX.Element> = {
  '/crm': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  '/crm/offerter': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  '/crm/samtal': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  '/crm/uppgifter': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  ),
  '/crm/prospekt': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  '/crm/affarsmojligheter': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  '/crm/arbetsorder': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    </svg>
  ),
  '/crm/ringlistor': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  '/crm/ai-prospekt': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
    </svg>
  ),
  '/crm/coach': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  '/crm/installningar': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
};

type CrmSidebarProps = {
  role: UserRole | null;
  userName?: string | null;
  userInitial?: string;
};

export default function CrmSidebar({ role, userName, userInitial = 'U' }: CrmSidebarProps) {
  const pathname = usePathname();
  const items = getVisibleCrmNavItems(role);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Per-group manual expand override; falls back to "open when a child is active".
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Reset pending state and close the mobile drawer whenever navigation completes.
  useEffect(() => {
    setPendingHref(null);
    setMobileOpen(false);
  }, [pathname]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  return (
    <>
      {/* Mobile top bar (hidden on desktop) */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 lg:hidden"
        style={{ backgroundColor: 'var(--crm-sidebar-bg)' }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Öppna meny"
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
          aria-controls="crm-sidebar-nav"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="text-sm font-bold text-white">Ekovilla</span>
        <span className="text-[11px] font-medium" style={{ color: 'var(--crm-sidebar-text-muted)' }}>CRM</span>
      </div>

      {/* Backdrop (mobile only, when open) */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Stäng meny"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <aside
        id="crm-sidebar-nav"
        aria-label="CRM-navigation"
        className={cn(
          'crm-sidebar flex w-56 shrink-0 flex-col overflow-y-auto',
          // Mobile: off-canvas drawer pinned below the global header
          'fixed left-0 z-50 h-[calc(100dvh-var(--header-base,56px)-var(--safe-top,0px))] top-[calc(var(--header-base,56px)_+_var(--safe-top,0px))] transition-transform duration-300 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static sticky sidebar (unchanged behavior)
          'lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 lg:transition-none'
        )}
        style={{ backgroundColor: 'var(--crm-sidebar-bg)' }}
      >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 pb-3 pt-5">
        <div>
          <p className="text-base font-bold leading-tight text-white">Ekovilla</p>
          <p className="text-[11px] font-medium" style={{ color: 'var(--crm-sidebar-text-muted)' }}>CRM System</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Stäng meny"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 lg:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="mx-3 mb-3 h-px" style={{ backgroundColor: 'var(--crm-sidebar-border)' }} />

      {/* Nav items */}
      <nav className="flex-1 px-2">
        <ul role="list" className="grid list-none gap-0.5 p-0">
          {items.map((item) => {
            // Renders a single navigable link, shared by top-level items and
            // dropdown children (children are indented and drop the icon).
            const renderLink = (navItem: CrmNavItem, active: boolean, isChild: boolean) => {
              const pending = pendingHref === navItem.href && !active;
              const icon = navIcons[navItem.href] ?? navIcons['/crm/installningar'];
              return (
                <Link
                  href={navItem.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => { if (!active) setPendingHref(navItem.href); }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl text-sm font-medium no-underline transition-colors',
                    isChild ? 'py-2 pl-11 pr-3 text-[13px]' : 'px-3 py-2.5',
                    active ? 'text-white' : pending ? 'text-emerald-300' : 'hover:text-white'
                  )}
                  style={
                    active
                      ? { backgroundColor: 'var(--crm-sidebar-active)', color: 'var(--crm-sidebar-text-active)' }
                      : pending
                        ? { color: '#6ee7b7' }
                        : { color: 'var(--crm-sidebar-text)' }
                  }
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--crm-sidebar-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = '';
                  }}
                >
                  {!isChild && (
                    <span className={cn('shrink-0', active ? 'text-emerald-300' : '')}>{icon}</span>
                  )}
                  <span className="truncate">{navItem.label}</span>
                </Link>
              );
            };

            const children = item.children ?? [];
            if (children.length > 0) {
              const childActive = activeChildHref(children, pathname);
              const groupActive = childActive !== null;
              const open = expanded[item.href] ?? groupActive;
              const icon = navIcons[item.href] ?? navIcons['/crm/installningar'];

              return (
                <li key={item.href}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded((prev) => ({ ...prev, [item.href]: !open }))}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                      groupActive ? 'text-white' : 'hover:text-white'
                    )}
                    style={{ color: groupActive ? '#ffffff' : 'var(--crm-sidebar-text)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--crm-sidebar-hover)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
                  >
                    <span className={cn('shrink-0', groupActive ? 'text-emerald-300' : '')}>{icon}</span>
                    <span className="flex-1 truncate text-left">{item.label}</span>
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                      className={cn('shrink-0 transition-transform', open && 'rotate-180')}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {open && (
                    <ul role="list" className="mt-0.5 grid list-none gap-0.5 p-0">
                      {children.map((child) => (
                        <li key={child.href}>{renderLink(child, childActive === child.href, true)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            }

            return <li key={item.href}>{renderLink(item, isHrefActive(item.href, pathname), false)}</li>;
          })}
        </ul>
      </nav>

      {/* User profile */}
      <div className="mx-3 mt-2 mb-3 h-px" style={{ backgroundColor: 'var(--crm-sidebar-border)' }} />
      <div className="flex items-center gap-2.5 px-4 pb-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
          {userInitial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-white">{userName || 'Användare'}</p>
          <p className="truncate text-[11px]" style={{ color: 'var(--crm-sidebar-text-muted)' }}>CRM</p>
        </div>
      </div>
      </aside>
    </>
  );
}
