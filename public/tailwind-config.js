/**
 * tailwind-config.js — design tokens from Figma "Catatan desain v2"
 *
 * Loaded right after the Tailwind CDN script on every page, so the
 * palette lives in one place instead of being repeated per page.
 *   kertas   #F8FAFC  page background
 *   tinta    #0F172A  headings, main text (isi #334155 body, lembut #475569 helper text)
 *   cap      #0369A1  the single accent: buttons, links, focus
 *   lengkap  #15803D  only for "ready / done" states
 *   tiket    #FEF3C7  ticket and "waiting" states, with #92400E text
 *   galat    #FEF2F2  errors, with #B91C1C text
 *   garis    #E2E8F0  borders and dividers
 */

tailwind.config = {
  theme: {
    extend: {
      colors: {
        kertas: "#f8fafc",
        abu: "#f1f5f9",      // info boxes, step icons
        malam: "#0f172a",    // info strip and footer background
        tinta: {
          DEFAULT: "#0f172a",
          isi: "#334155",
          lembut: "#475569",
          samar: "#64748b",  // placeholders
          terang: "#cbd5e1", // text on malam
          redup: "#94a3b8",  // fine print on malam
          garis: "#334155",  // divider on malam
        },
        cap: {
          DEFAULT: "#0369a1",
          tua: "#075985",   // hover state, text on cap-muda
          muda: "#e0f2fe",  // active menu, chips, icon boxes
          garis: "#bae6fd",
          terang: "#7dd3fc", // icons and links on malam
        },
        lengkap: {
          DEFAULT: "#15803d",
          tua: "#166534",   // text on lengkap-muda
          muda: "#dcfce7",
          garis: "#86efac",
        },
        tiket: {
          DEFAULT: "#fef3c7",
          tua: "#92400e",
        },
        galat: {
          DEFAULT: "#b91c1c",
          tua: "#991b1b",
          gelap: "#7f1d1d",
          muda: "#fef2f2",
          garis: "#fca5a5",
        },
        garis: {
          DEFAULT: "#e2e8f0",
          tegas: "#94a3b8",   // outline buttons and inputs
          pilihan: "#cbd5e1", // answer options
        },
        kerangka: "#e2e8f0", // loading skeleton bars
      },
      fontFamily: {
        sans: ['"Atkinson Hyperlegible Next"', "ui-sans-serif", "system-ui", "sans-serif"],
        judul: ['"Public Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Atkinson Hyperlegible Mono"', "ui-monospace", "monospace"],
      },
      maxWidth: {
        konten: "1200px", // 1440 px desktop with 120 px margins
      },
      boxShadow: {
        map: "0 4px 16px rgba(15, 23, 41, 0.06)",
        tiket: "0 8px 24px rgba(15, 23, 41, 0.08)",
        komposer: "0 -4px 16px rgba(15, 23, 41, 0.1)",
      },
    },
  },
};
