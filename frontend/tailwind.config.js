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
        'chip-in': {
          '0%':   { transform: 'translateY(4px) scale(0.96)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)',      opacity: '1' },
        },
        'chip-pop': {
          '0%':   { transform: 'translate(calc(-50% + var(--cx, 0px)), calc(-50% + var(--cy, 0px))) scale(0.3)', opacity: '0' },
          '60%':  { transform: 'translate(-50%, -50%) scale(1.08)', opacity: '1' },
          '100%': { transform: 'translate(-50%, -50%) scale(1)',    opacity: '1' },
        },
        'send-sweep': {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'send-pulse': {
          '0%':   { transform: 'scale(1)' },
          '40%':  { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
        'send-fly-in': {
          '0%':   { transform: 'translateY(28px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
      },
      animation: {
        'send-launch':  'send-launch 0.32s cubic-bezier(0.4, 0, 1, 1) forwards',
        'chip-in':      'chip-in 0.22s cubic-bezier(0.32, 0.72, 0, 1) both',
        'chip-pop':     'chip-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'send-sweep':   'send-sweep 0.9s linear infinite',
        'send-pulse':   'send-pulse 0.55s cubic-bezier(0.4, 0, 0.2, 1)',
        'send-fly-in':  'send-fly-in 0.24s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
