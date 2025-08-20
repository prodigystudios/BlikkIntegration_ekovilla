import './globals.css';
import HeaderMenu from './components/HeaderMenu';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Optional: restrict pinch-zoom. Consider accessibility before using.
  maximumScale: 1,
  userScalable: false,
} as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
    <head>
      <link rel="icon" href="/brand/ekovilla-logga-transparent.png" />
      <link rel="apple-touch-icon" href="/brand/ekovilla-logga-transparent.png" />
    </head>
  <body style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', margin: 0, width: '100%', overflowX: 'hidden' }}>
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
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}
        >
          <img src="/brand/EkovillaloggaNoBg.png" alt="Ekovilla" height={76} style={{ display: 'block', transform: 'scale(1.5)', transformOrigin: 'left center' }} />
          <strong style={{ letterSpacing: 0.2 }}>Egenkontroll</strong>
          <div style={{ marginLeft: 'auto' }} />
          <HeaderMenu />
        </header>
        {/* Content wrapper with top padding to avoid overlap */} 
        <div style={{ paddingTop: 64 }}>{children}</div>
      </body>
    </html>
  );
}
