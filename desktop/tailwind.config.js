/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        'bg-surface': 'var(--color-bg-surface)',
        accent: 'var(--color-accent)',
        'accent-light': 'var(--color-accent-light)',
        'accent-soft': 'var(--color-accent-soft)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-tertiary': 'var(--color-text-tertiary)',
        divider: 'var(--color-divider)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '18px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 2px 8px rgba(0,0,0,0.08)',
        lg: '0 4px 16px rgba(0,0,0,0.12)',
      },
      fontSize: {
        caption: ['12px', { lineHeight: '16px' }],
        'body-sm': ['13px', { lineHeight: '18px' }],
        body: ['15px', { lineHeight: '22px' }],
        heading: ['20px', { lineHeight: '28px' }],
        title: ['22px', { lineHeight: '30px' }],
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '28px',
        '3xl': '36px',
      },
    },
  },
  plugins: [],
};
