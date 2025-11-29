import './globals.css';
import HeaderMenu from './components/HeaderMenu';
import Script from 'next/script';
import HeaderTitle from './components/HeaderTitle';
import { getUserProfile } from '../lib/getUserProfile';
import { UserProfileProvider } from '../lib/UserProfileContext';
import { ToastProvider } from '../lib/Toast';
import Link from 'next/link';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Optional: restrict pinch-zoom. Consider accessibility before using.
  maximumScale: 1.1,
  userScalable: true,
  viewportFit: 'cover',
} as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Single consolidated profile fetch (includes role + name)
  const profile = await getUserProfile();
  const role = profile?.role || null;
  const isAuthPath = typeof (global as any).window === 'undefined' ? false : false; // placeholder (SSR can't read pathname)
  // We will do a simple runtime check client side via a data attribute to hide header on auth pages when unauthenticated.
  // If no profile (not logged in) and path starts with /auth we suppress the header entirely via inline JS.
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
          {/* Fixed, full-width header (hidden on auth pages when not logged in) */}
          <header
            className="header-app"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              background: '#ffffffff',
              color: '#0b0f10',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 16,
              paddingRight: 16,
              gap: 25,
              zIndex: 1000,
              boxShadow: '0 8px 8px rgba(0,0,0,0.08)'
            }}
          >
            <Link href="/" aria-label="Gå till startsidan" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              <img src="/brand/Ekovilla_logo_Header.png" alt="Ekovilla header logo" height={18} style={{ display: 'block', transform: 'scale(1.5)', transformOrigin: 'left center' }} />
            </Link>
            {/* Client-only header title */}
            <HeaderTitle />
            <div style={{ marginLeft: 'auto' }} />
            <HeaderMenu role={role} fullName={profile?.full_name || null} />
          </header>
          {/* Content wrapper with top padding to avoid overlap (responsive + safe area) */}
          <div className="content-offset">{children}</div>
        </ToastProvider>
      </UserProfileProvider>
      <script
        dangerouslySetInnerHTML={{
          __html: `(()=>{try{var hasUser=document.body.getAttribute('data-has-user')==='true';var p=location.pathname;if(!hasUser && p.startsWith('/auth')){var h=document.querySelector('header.header-app');if(h) h.style.display='none';var c=document.querySelector('.content-offset');if(c) c.style.paddingTop='0';}}catch(e){}})();`
        }}
      />
      <Script id="sw-register" strategy="afterInteractive">
        {`
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        `}
      </Script>
    </body>
    </html>
  );
}