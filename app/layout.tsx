import './globals.css';
import Script from 'next/script';
import { getUserProfile } from '../lib/getUserProfile';
import { UserProfileProvider } from '../lib/UserProfileContext';
import { ToastProvider } from '../lib/Toast';
import { TruckAssignmentsProvider } from '../lib/TruckAssignmentsContext';
import AppShell from './components/AppShell';
import InstallPrompt from '../components/pwa/InstallPrompt';
import ReportIssueLauncher from './components/ReportIssueLauncher';
import { getCanonicalOrigin } from '../lib/publicOrigin';
import type { Metadata, Viewport } from 'next';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Optional: restrict pinch-zoom. Consider accessibility before using.
  maximumScale: 2.0,
  userScalable: true,
  viewportFit: 'cover',
  // theme-color och color-scheme skrevs tidigare för hand i <head>. I Next 14 hör de hemma i
  // viewport-exporten, inte i metadata — samma taggar, ett ställe.
  themeColor: '#1f7a3d',
  colorScheme: 'light',
};

/**
 * metadataBase låser den kanoniska domänen.
 *
 * Appen svarar på två adresser: app.ekovilla.se och den gamla vercel.app-adressen, som ligger kvar
 * tills den stängs kontrollerat. Utan en bas löser Next relativa metadata-URL:er mot den host som
 * råkade servera requesten, och en OG-bild hade fått olika absolut adress beroende på var
 * användaren kom in. Domänen hämtas från NEXT_PUBLIC_SITE_URL via samma helper som resten av
 * appen, så metadata och länkbyggande inte kan glida isär.
 *
 * SEO-värdet är noll — allt utom inloggningen ligger bakom auth. Poängen är en stabil bas.
 */
export const metadata: Metadata = {
  metadataBase: new URL(getCanonicalOrigin()),
  title: {
    default: 'Ekovilla',
    template: '%s · Ekovilla',
  },
  applicationName: 'Ekovilla',
  description: 'Ekovillas interna app för order, planering, tid och dokument.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Ekovilla',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    siteName: 'Ekovilla',
    title: 'Ekovilla',
    description: 'Ekovillas interna app för order, planering, tid och dokument.',
    // Relativ med flit: metadataBase gör den absolut mot den kanoniska domänen.
    url: '/',
    locale: 'sv_SE',
  },
  // mobile-web-app-capable har ingen egen nyckel i Next 14:s metadata-API. Den låg i <head>
  // tidigare och behövs fortfarande för Android/Chrome.
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Single consolidated profile fetch (includes role + name)
  const profile = await getUserProfile();
  const role = profile?.role || null;
  const fullName = profile?.full_name || null;
  const userInitial = fullName ? fullName.charAt(0).toUpperCase() : 'U';
  // Ingen handskriven <head> längre: allt som låg där ligger i metadata-/viewport-exporterna
  // ovan, och Next renderar samma taggar därifrån.
  return (
    <html lang="en">
    <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', margin: 0, width: '100%', overflowX: 'hidden', minHeight: '100dvh', background: '#fff', paddingBottom: 'env(safe-area-inset-bottom)' }} data-has-user={!!profile}>
      <UserProfileProvider profile={profile}>
        <ToastProvider>
          <TruckAssignmentsProvider>
            <AppShell role={role} fullName={fullName} userInitial={userInitial}>
              {children}
            </AppShell>
            <InstallPrompt loggedIn={!!profile} />
            {/* Utanför AppShell med flit: fältvyn /arbetsorder renderas utan skal, och det är
                installatörerna som ser flest buggar. Komponenten gömmer sig själv på inloggnings-
                och kundsidorna. */}
            <ReportIssueLauncher loggedIn={!!profile} />
          </TruckAssignmentsProvider>
        </ToastProvider>
      </UserProfileProvider>
      <Script id="sw-register" strategy="afterInteractive">
        {`
          if ('serviceWorker' in navigator) {
            const registerServiceWorker = () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            };

            if (document.readyState === 'complete') {
              registerServiceWorker();
            } else {
              window.addEventListener('load', registerServiceWorker, { once: true });
            }
          }
        `}
      </Script>
    </body>
    </html>
  );
}