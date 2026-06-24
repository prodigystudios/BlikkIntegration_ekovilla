import './globals.css';
import Script from 'next/script';
import { getUserProfile } from '../lib/getUserProfile';
import { UserProfileProvider } from '../lib/UserProfileContext';
import { ToastProvider } from '../lib/Toast';
import { TruckAssignmentsProvider } from '../lib/TruckAssignmentsContext';
import AppShell from './components/AppShell';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Optional: restrict pinch-zoom. Consider accessibility before using.
  maximumScale: 2.0,
  userScalable: true,
  viewportFit: 'cover',
} as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Single consolidated profile fetch (includes role + name)
  const profile = await getUserProfile();
  const role = profile?.role || null;
  const fullName = profile?.full_name || null;
  const userInitial = fullName ? fullName.charAt(0).toUpperCase() : 'U';
  return (
    <html lang="en">
    <head>
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes='180x180'/>
      <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#ffffff" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content="Egenkontroll" />
  <meta name="color-scheme" content="light" />
    </head>
    <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', margin: 0, width: '100%', overflowX: 'hidden', minHeight: '100dvh', background: '#fff', paddingBottom: 'env(safe-area-inset-bottom)' }} data-has-user={!!profile}>
      <UserProfileProvider profile={profile}>
        <ToastProvider>
          <TruckAssignmentsProvider>
            <AppShell role={role} fullName={fullName} userInitial={userInitial}>
              {children}
            </AppShell>
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