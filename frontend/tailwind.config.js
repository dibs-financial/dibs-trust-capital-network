/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dibs: {
          50: '#f0f4f8',
          100: '#e0e9f1',
          200: '#c7d7e9',
          300: '#9bb8d4',
          400: '#6a91ba',
          500: '#4870a0',
          600: '#365985',
          700: '#2c496e',
          800: '#283f5b',
          900: '#243650',
          950: '#1a2536',
        },
        sentinel: {
          DEFAULT: '#4870a0',
          light: '#6a91ba',
        },
        catalyst: {
          DEFAULT: '#b45309',
          light: '#d97706',
        },
      },
    },
  },
  plugins: [],
};
