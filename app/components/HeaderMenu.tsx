"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function HeaderMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Meny"
        onClick={() => setOpen((v) => !v)}
        style={{ padding: 8, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", display: "inline-flex" }}
      >
        {/* Simple hamburger icon */}
        <svg width="22" height="18" viewBox="0 0 22 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="20" height="2" rx="1" fill="#111827"/>
          <rect x="1" y="8" width="20" height="2" rx="1" fill="#111827"/>
          <rect x="1" y="15" width="20" height="2" rx="1" fill="#111827"/>
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Huvudmeny"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 8,
            minWidth: 200,
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            padding: 8,
            zIndex: 1100,
          }}
        >
          <Link href="/" prefetch={false} role="menuitem" onClick={() => setOpen(false)}
                style={{ display: "block", padding: "10px 12px", borderRadius: 6, color: "#111827", textDecoration: "none" }}
          >
            Startsida
          </Link>
          <Link href="/archive" prefetch={false} role="menuitem" onClick={() => setOpen(false)}
                style={{ display: "block", padding: "10px 12px", borderRadius: 6, color: "#111827", textDecoration: "none" }}
          >
            Egenkontroller
          </Link>
        </div>
      )}
    </div>
  );
}
