/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{svelte,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        segoe: [
          '"Segoe UI Variable"',
          '"Segoe UI"',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'sans-serif',
        ],
      },
      colors: {
        fluent: {
          accent: {
            DEFAULT: '#0078D4',
            hover: '#1984d8',
            active: '#006cbf',
            light: '#2b88d8',
            dark: '#005a9e',
            subtle: 'rgba(0, 120, 212, 0.1)',
          },
          dark: {
            bg: '#202020',
            card: '#2c2c2c',
            subtle: '#333333',
            hover: 'rgba(255, 255, 255, 0.07)',
            active: 'rgba(255, 255, 255, 0.04)',
            border: 'rgba(255, 255, 255, 0.08)',
            borderCard: 'rgba(255, 255, 255, 0.12)',
            textPrimary: '#ffffff',
            textSecondary: 'rgba(255, 255, 255, 0.70)',
            textDisabled: 'rgba(255, 255, 255, 0.38)',
          },
          light: {
            bg: '#f3f3f3',
            card: '#ffffff',
            subtle: '#edebe9',
            hover: 'rgba(0, 0, 0, 0.05)',
            active: 'rgba(0, 0, 0, 0.03)',
            border: 'rgba(0, 0, 0, 0.08)',
            borderCard: 'rgba(0, 0, 0, 0.12)',
            textPrimary: '#1f1f1f',
            textSecondary: 'rgba(0, 0, 0, 0.61)',
            textDisabled: 'rgba(0, 0, 0, 0.36)',
          },
        },
      },
      borderRadius: {
        'fluent-btn': '4px',
        'fluent-card': '8px',
        'fluent-dialog': '12px',
        'fluent-pill': '9999px',
      },
      boxShadow: {
        'fluent-flyout': '0 8px 24px rgba(0, 0, 0, 0.35), 0 0 1px rgba(255, 255, 255, 0.1)',
        'fluent-card': '0 2px 6px rgba(0, 0, 0, 0.18)',
        'fluent-pill': '0 4px 16px rgba(0, 0, 0, 0.35)',
      },
    },
  },
  plugins: [],
};

