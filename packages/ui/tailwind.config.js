/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        battery: '#34d399',  // emerald-400
        solar:   '#facc15',  // amber-400
        current: '#60a5fa',  // blue-400
        load:    '#c084fc',  // purple-400
      },
    },
  },
}
