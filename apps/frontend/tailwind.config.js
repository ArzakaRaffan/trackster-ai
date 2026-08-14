/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        interactive: 'var(--interactive)',
        hover: 'var(--hover)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-disabled': 'var(--text-disabled)',
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
          border: 'var(--accent-border)',
          pressed: 'var(--accent-pressed)',
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          error: 'var(--status-error)',
          info: 'var(--status-info)',
        },
      },
      fontFamily: {
        sans: ['Figtree', 'ui-sans-serif', 'system-ui', '-apple-system', "'Segoe UI'", 'sans-serif'],
      },
      fontSize: {
        title: ['24px', { lineHeight: '1.2', fontWeight: '700' }],
        'section-heading': ['18px', { lineHeight: '1.25', fontWeight: '600' }],
        body: ['16px', { lineHeight: '1.3' }],
        label: ['14px', { lineHeight: '1.2', fontWeight: '600' }],
        caption: ['12px', { lineHeight: '1.5' }],
        badge: ['10.5px', { lineHeight: '1.2', fontWeight: '600' }],
        micro: ['10px', { lineHeight: '1.2' }],
      },
      borderRadius: {
        row: '6px',
        card: '8px',
        hero: '10px',
        pill: '9999px',
        'pill-lg': '500px',
        circle: '50%',
      },
      boxShadow: {
        dropdown: 'rgba(0, 0, 0, 0.3) 0 8px 8px',
        dialog: 'rgba(0, 0, 0, 0.5) 0 8px 24px',
        inset: 'rgb(124,124,124) 0 0 0 1px inset',
        'inset-focus': 'var(--accent) 0 0 0 1px inset',
        'inset-error': 'var(--status-error) 0 0 0 1px inset',
      },
      transitionTimingFunction: {
        hover: 'cubic-bezier(.3,0,.4,1)',
        motion: 'cubic-bezier(.16,1,.3,1)',
      },
      transitionDuration: {
        hover: '200ms',
        motion: '320ms',
        press: '120ms',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};
