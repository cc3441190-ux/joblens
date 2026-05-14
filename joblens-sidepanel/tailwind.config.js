/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#1677FF",
        page: "#F0F2F5",
        "gap-fatal": "#FF4D4F",
        "gap-nice": "#FAAD14",
        "gap-good": "#52C41A",
      },
      fontSize: {
        display: ["48px", { lineHeight: "1.1", fontWeight: "700" }],
      },
      boxShadow: {
        card: "0 2px 8px rgba(0,0,0,0.04)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.08)",
      },
      transitionTimingFunction: {
        "out-pane": "cubic-bezier(0.33, 1, 0.68, 1)",
      },
    },
  },
  plugins: [],
};
