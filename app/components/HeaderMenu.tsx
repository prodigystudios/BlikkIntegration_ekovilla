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
function IconDoc(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <path d="M9 7h6"/><path d="M9 12h6"/><path d="M9 17h2"/>
    </svg>
  );
}
function IconYouTube(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden focusable="false" {...props}>
      <rect x="2" y="6" width="20" height="12" rx="3" fill="#FF0000" />
      <path d="M10 9l5 3-5 3z" fill="#ffffff" />
    </svg>
  );
}
function IconLinkedIn(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden focusable="false" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#0A66C2" />
      {/* dot of i */}
      <circle cx="8" cy="9" r="1.1" fill="#ffffff" />
      {/* stem of i */}
      <rect x="7.3" y="10.5" width="1.4" height="6.5" rx="0.7" fill="#ffffff" />
      {/* simplified n */}
      <path d="M11 11h2c1.66 0 3 1.34 3 3v3.5h-2v-3.5c0-.55-.45-1-1-1h-2V17.5h-2V11h2z" fill="#ffffff" />
    </svg>
  );
}
function IconFacebook(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden focusable="false" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#1877F2" />
      <path d="M14 10h2V7h-2c-1.66 0-3 1.34-3 3v2H9v3h2v6h3v-6h2l.7-3H14v-2z" fill="#ffffff" />
    </svg>
  );
}
function IconInstagram(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden focusable="false" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#E1306C" />
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="#ffffff" strokeWidth="2" />
      <circle cx="17" cy="7.5" r="1.2" fill="#ffffff" />
    </svg>
  );
}
function IconShirt(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {/* Neckline */}
      <path d="M9 4h6"/>
      {/* Outline with sleeves */}
      <path d="M9 4l-2 2-2 1v3h3v10h8V10h3V7l-2-1-2-2"/>
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
function IconCar(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3 13l2-5a3 3 0 0 1 2.82-2h8.36A3 3 0 0 1 19 8l2 5"/>
      <path d="M5 16h14"/>
      <circle cx="7.5" cy="16.5" r="1.5"/>
      <circle cx="16.5" cy="16.5" r="1.5"/>
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
          style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(10px + env(safe-area-inset-top)) 16px 14px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <strong>Meny</strong>
            <button aria-label="Stäng meny" onClick={() => setOpen(false)} className="btn--plain" style={{ padding: 8, borderRadius: 6 }}>
              {/* X icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <nav style={{ padding: 8, flex: '1 1 auto', overflowY: 'auto' }}>
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
              <span>Kontakt & Adresser</span>
            </Link>
            <Link href="/dokument-information" prefetch={true} onClick={() => setOpen(false)}
              aria-current={pathname === '/dokument-information' ? 'page' : undefined}
              className={`menu-link${pathname === '/dokument-information' ? ' is-active' : ''}`}>
              <IconDoc />
              <span>Dokument & Information</span>
            </Link>
            <Link href="/bestallning-klader" prefetch={true} onClick={() => setOpen(false)}
              aria-current={pathname === '/bestallning-klader' ? 'page' : undefined}
              className={`menu-link${pathname === '/bestallning-klader' ? ' is-active' : ''}`}>
              <IconShirt />
              <span>Beställning kläder</span>
            </Link>
            <Link href="/material-kvalitet" prefetch={false} onClick={() => setOpen(false)}
              aria-current={pathname === '/material-kvalitet' ? 'page' : undefined}
              className={`menu-link${pathname === '/material-kvalitet' ? ' is-active' : ''}`}>
              <IconArchive />
              <span>Materialkvalitet</span>
            </Link>

            {/* Divider before sales section */}
            <div role="separator" aria-hidden style={{ height: 1, background: '#e5e7eb', margin: '8px 8px' }} />
            <div style={{ fontSize: 12, color: '#6b7280', margin: '6px 8px' }}>Säljare</div>
            <Link href="/korjournal" prefetch={true} onClick={() => setOpen(false)}
              aria-current={pathname === '/korjournal' ? 'page' : undefined}
              className={`menu-link${pathname === '/korjournal' ? ' is-active' : ''}`}>
              <IconCar />
              <span>Körjournal</span>
            </Link>
          </nav>

          {/* Social media footer */}
          <div style={{ padding: '8px calc(8px + env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) 8px', borderTop: '1px solid #e5e7eb', marginTop: 'auto' }}>
            <div style={{ fontSize: 12, color: '#6b7280', margin: '6px 8px' }}>Sociala medier</div>
            <div style={{ display: 'flex', justifyContent: 'space-evenly', gap: 12, padding: '0 8px 8px 8px' }}>
              <a href="https://www.youtube.com/@isoleringslandslaget8661" target="_blank" rel="noopener noreferrer" aria-label="YouTube" onClick={() => setOpen(false)} className="btn--plain" style={{ padding: 6, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', display: 'inline-flex' }}>
                <IconYouTube />
              </a>
              <a href="https://www.linkedin.com/company/isoleringslandslaget" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" onClick={() => setOpen(false)} className="btn--plain" style={{ padding: 6, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', display: 'inline-flex' }}>
                <IconLinkedIn />
              </a>
              <a href="https://www.facebook.com/isoleringslandslaget/" target="_blank" rel="noopener noreferrer" aria-label="Facebook" onClick={() => setOpen(false)} className="btn--plain" style={{ padding: 6, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', display: 'inline-flex' }}>
                <IconFacebook />
              </a>
              <a href="https://www.instagram.com/isoleringslandslaget/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" onClick={() => setOpen(false)} className="btn--plain" style={{ padding: 6, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', display: 'inline-flex' }}>
                <IconInstagram />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
