"use client";
import { usePathname } from "next/navigation";

export default function HeaderTitle() {
  const pathname = usePathname();
  let title = 'Egenkontroll';
  if (pathname === '/') title = 'Startsida';
  else if (pathname.startsWith('/archive')) title = 'Egenkontroller';
  else if (pathname.startsWith('/kontakt-lista')) title = 'Kontakt & Adresser';
  return <strong style={{ letterSpacing: 0.2, marginLeft:36, marginTop:4 }}>{title}</strong>;
}
