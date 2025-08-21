"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function IconMenu(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden focusable="false" {...props}>
      <rect x="1" y="1" width="20" height="2" rx="1" fill="#111827"/>
      <rect x="1" y="8" width="20" height="2" rx="1" fill="#111827"/>
      <rect x="1" y="15" width="20" height="2" rx="1" fill="#111827"/>
    </svg>
  );
}
function IconHome(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3 11l9-7 9 7"/><path d="M9 22V12h6v10"/>
    </svg>
  );
}
function IconArchive(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7"/><path d="M9 12h6"/>
    </svg>
  );
}
function IconPhone(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.62 2.61a2 2 0 0 1-.45 2.11L8 9a16 16 0 0 0 7 7l.56-1.28a2 2 0 0 1 2.11-.45c.84.29 1.71.5 2.61.62A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}

export default function HeaderMenu() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null);
  const pathname = usePathname();

  // Close on Esc and click outside; lock body scroll when open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      // Focus trap when drawer open
      if (open && e.key === 'Tab') {
        const root = panelRef.current;
        if (!root) return;
        const focusables = Array.from(root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.hasAttribute('inert'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first || !root.contains(active)) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (active === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    }
    function onClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      // If clicking backdrop, close
      if (panelRef.current && panelRef.current.parentElement && panelRef.current.parentElement.classList.contains('drawer-root')) {
        const root = panelRef.current.parentElement;
        if (t === root) setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    if (open) {
      document.body.style.overflow = 'hidden';
      // focus first link for accessibility
      setTimeout(() => firstLinkRef.current?.focus(), 0);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="main-menu-drawer"
        aria-label="Meny"
        onClick={() => setOpen(true)}
        style={{ padding: 8, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", display: "inline-flex" }}
      >
        <IconMenu />
      </button>

      {/* Backdrop + Drawer */}
      <div
        className={`drawer-root${open ? ' drawer-root--open' : ''}`}
        role={open ? 'presentation' : undefined}
        onClick={(e) => {
          // Clicking backdrop closes; clicks inside panel shouldn't bubble
          if (e.target === e.currentTarget) setOpen(false);
        }}
        style={{ pointerEvents: open ? 'auto' : 'none' }}
      >
        <div className={`drawer-backdrop${open ? ' drawer-backdrop--show' : ''}`} />
        <div
          id="main-menu-drawer"
          ref={panelRef}
          className={`drawer${open ? ' drawer--open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Huvudmeny"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <strong>Meny</strong>
            <button aria-label="Stäng meny" onClick={() => setOpen(false)} className="btn--plain" style={{ padding: 8, borderRadius: 6 }}>
              {/* X icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <nav style={{ padding: 8 }}>
            <Link ref={firstLinkRef} href="/" prefetch={false} onClick={() => setOpen(false)}
              aria-current={pathname === '/' ? 'page' : undefined}
              className={`menu-link${pathname === '/' ? ' is-active' : ''}`}>
              <IconHome />
              <span>Startsida</span>
            </Link>
            <Link href="/archive" prefetch={false} onClick={() => setOpen(false)}
              aria-current={pathname?.startsWith('/archive') ? 'page' : undefined}
              className={`menu-link${pathname?.startsWith('/archive') ? ' is-active' : ''}`}>
              <IconArchive />
              <span>Egenkontroller</span>
            </Link>
            <Link href="/kontakt-lista" prefetch={true} onClick={() => setOpen(false)}
              aria-current={pathname === '/kontakt-lista' ? 'page' : undefined}
              className={`menu-link${pathname === '/kontakt-lista' ? ' is-active' : ''}`}>
              <IconPhone />
              <span>Kontaktlista</span>
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
