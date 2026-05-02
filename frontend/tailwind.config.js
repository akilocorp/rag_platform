/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'send-launch': {
          '0%':   { transform: 'translate(0, 0) scale(1)', opacity: '1' },
          '100%': { transform: 'translate(10px, -10px) scale(0.3)', opacity: '0' },
        },
      },
      animation: {
        'send-launch': 'send-launch 0.32s cubic-bezier(0.4, 0, 1, 1) forwards',
      },
    },
  },
  plugins: [],
}
