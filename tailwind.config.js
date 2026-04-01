/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          bg: "#141a14",
          surface: "#1b231b",
          border: "#2a352a",
          text: "#d4d8c8",
          muted: "#7a8570",
        },
        accent: {
          orange: "#c8914a",
          green: "#6abf69",
          blue: "#6b9eca",
          red: "#c45c5c",
          amber: "#d4a843",
        },
      },
    },
  },
  plugins: [],
};
