/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        ui: {
          page: 'var(--ui-surface-page)',
          surface: 'var(--ui-surface-card)',
          muted: 'var(--ui-surface-muted)',
          border: 'var(--ui-border-subtle)',
          accent: 'var(--ui-accent)',
          accentSoft: 'var(--ui-accent-soft)',
          text: {
            strong: 'var(--ui-text-strong)',
            muted: 'var(--ui-text-muted)',
            soft: 'var(--ui-text-soft)',
          },
        },
      },
      borderRadius: {
        shell: 'var(--ui-radius-shell)',
        card: 'var(--ui-radius-card)',
      },
      boxShadow: {
        soft: 'var(--ui-shadow-soft)',
      },
    },
  },
  plugins: [],
};