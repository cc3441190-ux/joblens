/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#1677FF",
        page: "#F0F2F5",
        must: "#FF4D4F",
        nice: "#FAAD14",
        hl: "#52C41A",
        todoBg: "#F5F5F5",
        afterBg: "#E6F4FF",
      },
      boxShadow: {
        card: "0 2px 8px rgba(0,0,0,0.04)",
        cardHover: "0 4px 14px rgba(0,0,0,0.08)",
      },
    },
  },
  plugins: [],
};
