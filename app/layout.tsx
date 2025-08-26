import './globals.css';
import HeaderMenu from './components/HeaderMenu';
import Script from 'next/script';
import HeaderTitle from './components/HeaderTitle';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Optional: restrict pinch-zoom. Consider accessibility before using.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
} as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
    <head>
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes='180x180'/>
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="theme-color" content="#0ea5e9" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="Egenkontroll" />
  <meta name="color-scheme" content="light" />
    </head>
    <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', margin: 0, width: '100%', overflowX: 'hidden', minHeight: '100dvh', background: '#fff' }}>
      {/* Fixed, full-width header */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 64,
          background: '#ffffffff',
          color: '#0b0f10',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 25,
          zIndex: 1000,
          boxShadow: '0 8px 8px rgba(0,0,0,0.08)'
        }}
      >
        <img src="/brand/Ekovilla_logo_Header.png" alt="Ekovilla header logo" height={18} style={{ display: 'block', transform: 'scale(1.5)', transformOrigin: 'left center' }} />
  {/* Client-only header title */}
  <HeaderTitle />
        <div style={{ marginLeft: 'auto' }} />
        <HeaderMenu />
      </header>
      {/* Content wrapper with top padding to avoid overlap */} 
      <div style={{ paddingTop: 64 }}>{children}</div>
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