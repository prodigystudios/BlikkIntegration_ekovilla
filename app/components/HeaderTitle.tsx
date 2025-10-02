"use client";
import { usePathname } from "next/navigation";

export default function HeaderTitle() {
  const pathname = usePathname();
  let title = 'Egenkontroll';
  if (pathname === '/') title = 'Startsida';
  else if (pathname.startsWith('/egenkontroll')) title = 'Skapa egenkontroll';
  else if (pathname.startsWith('/archive')) title = 'Sparade egenkontroller';
  else if (pathname.startsWith('/kontakt-lista')) title = 'Kontakt & Adresser';
  else if (pathname.startsWith('/dokument-information')) title = 'Dokument & Information';
  else if (pathname.startsWith('/bestallning-klader')) title = 'Beställa kläder';
  else if (pathname.startsWith('/korjournal')) title = 'Körjournal';
  else if (pathname.startsWith('/plannering')) title = 'Planering';
  else if (pathname.startsWith('/auth/sign-in')) title = 'Logga in';
  else if (pathname.startsWith('/auth/create-account')) title = 'Skapa konto';
  else if (pathname.startsWith('/admin')) title = 'Admin';
  return <strong style={{ letterSpacing: 0.2, marginLeft:36, marginTop:4 }}>{title}</strong>;
}
