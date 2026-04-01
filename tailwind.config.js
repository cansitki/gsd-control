/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          bg: "#0c0f17",
          surface: "#131722",
          border: "#1e2333",
          text: "#c8cdd8",
          muted: "#6b7280",
        },
        accent: {
          orange: "#f97316",
          green: "#22c55e",
          blue: "#3b82f6",
          red: "#ef4444",
          amber: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
};
