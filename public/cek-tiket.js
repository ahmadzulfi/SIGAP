/**
 * cek-tiket.js — Tanya Layanan, halaman Cek tiket (Web 07, desain v2)
 *
 * Architecture:
 *   - hasilTiket : the last ticket fetched (or null)
 *   - render()   : the only function that writes the result card
 *   - The page also accepts ?kode=TL-XXXXXX so the link on the ticket
 *     card opens straight to the answer.
 */

"use strict";

/* ==========================================================
   1. STATE
   ========================================================== */

/**
 * @type {{
 *   kode: string,
 *   status: "menunggu" | "dijawab",
 *   pertanyaan: string,
 *   jawaban: string | null,
 *   dibuat: string,
 *   dijawabPada: string | null
 * } | null}
 */
let hasilTiket = null;

/** true / false once the citizen rated the officer's answer, null before. */
let penilaian = null;

/* ==========================================================
   2. DOM REFERENCES
   ========================================================== */

const formTiket   = document.getElementById("form-tiket");
const inputKode   = document.getElementById("input-kode");
const tombolCek   = formTiket.querySelector("button");
const galatTiket  = document.getElementById("galat-tiket");
const judulGalat  = document.getElementById("judul-galat-tiket");
const isiGalat    = document.getElementById("isi-galat-tiket");
const wadahHasil  = document.getElementById("hasil-tiket");

/* ==========================================================
   3. UTILITY HELPERS
   ========================================================== */

/**
 * Sanitise a string to prevent XSS when inserted into the DOM.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

/**
 * Normalise what a citizen types ("tl 7k2qxm", "7K2QXM") to "TL-7K2QXM".
 * Mirrors rapikanKode() on the server.
 * @param {string} input
 * @returns {string}
 */
function rapikanKode(input) {
  const inti = input.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^TL/, "");
  return inti ? `TL-${inti}` : "";
}

/**
 * "2026-10-07T03:15:00Z" → "7 Okt 2026, 10.15" (local time).
 * @param {string} iso
 * @param {{ tahun?: boolean }} [opsi] — without the year for the timeline ("7 Okt, 10.15")
 * @returns {string}
 */
function formatTanggal(iso, { tahun = true } = {}) {
  const waktu = new Date(iso);
  const tanggal = waktu.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    ...(tahun ? { year: "numeric" } : {}),
  });
  const jam = waktu.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${tanggal}, ${jam}`;
}

/** Lucide icon from assets/ikon at its native size. */
function ikon(nama, ukuran, kelas = "shrink-0") {
  return `<img src="assets/ikon/${nama}.svg" width="${ukuran}" height="${ukuran}" alt="" class="${kelas}" />`;
}

/**
 * Show or hide the red message box under the form.
 * @param {string} judul — empty string hides it
 * @param {string} [isi]
 */
function tampilkanGalat(judul, isi = "") {
  judulGalat.textContent = judul;
  isiGalat.textContent = isi;
  isiGalat.classList.toggle("hidden", !isi);
  galatTiket.classList.toggle("hidden", !judul);
  galatTiket.classList.toggle("flex", Boolean(judul));
}

/* ==========================================================
   4. API — GET /api/tiket/:kode
   ========================================================== */

/**
 * Fetch a ticket and update the page.
 * @param {string} kode — already normalised
 */
async function cekTiket(kode) {
  tombolCek.disabled = true;
  tampilkanGalat("");

  try {
    const response = await fetch(`/api/tiket/${encodeURIComponent(kode)}`);

    if (response.status === 404) {
      hasilTiket = null;
      tampilkanGalat("Kode tidak ditemukan", "Cek lagi hurufnya, misalnya O (huruf) dan 0 (angka).");
    } else if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    } else {
      hasilTiket = await response.json();
      penilaian = null;
      // Keep the code in the address bar so the page can be bookmarked
      history.replaceState(null, "", `?kode=${encodeURIComponent(hasilTiket.kode)}`);
    }
  } catch {
    hasilTiket = null;
    tampilkanGalat("Tiket belum bisa dicek", "Coba lagi sebentar lagi.");
  }

  tombolCek.disabled = false;
  render();
}

/* ==========================================================
   5. RENDER
   ========================================================== */

/**
 * Status timeline. "Dibaca petugas" is left out: the backend does not record it.
 * @param {NonNullable<typeof hasilTiket>} t
 * @returns {string}
 */
function htmlLinimasa(t) {
  const tahap = [
    { label: "Dikirim", waktu: t.dibuat },
    { label: "Dijawab", waktu: t.status === "dijawab" ? t.dijawabPada : null },
  ];

  return `
    <ol class="flex">
      ${tahap.map((th, i) => {
        const selesai = Boolean(th.waktu);
        const terakhir = i === tahap.length - 1;
        const berikutnyaSelesai = !terakhir && Boolean(tahap[i + 1].waktu);
        return `
          <li class="flex-1 min-w-0 flex flex-col gap-2">
            <span class="flex items-center" aria-hidden="true">
              ${selesai
                ? `<span class="shrink-0 bg-lengkap rounded-full size-7 flex items-center justify-center">${ikon("check-putih-16", 16)}</span>`
                : `<span class="shrink-0 bg-white border-2 border-garis-pilihan rounded-full size-7"></span>`}
              ${terakhir ? "" : `<span class="flex-1 h-[3px] ${berikutnyaSelesai ? "bg-lengkap" : "bg-garis"}"></span>`}
            </span>
            <span class="text-[15px] leading-[22px] font-bold ${selesai ? "" : "text-tinta-lembut"}">
              <span class="sr-only">${selesai ? "Selesai" : "Belum"}: </span>${th.label}
            </span>
            <span class="text-[13px] leading-[18px] text-tinta-lembut">
              ${selesai ? escapeHTML(formatTanggal(th.waktu, { tahun: false })) : "Belum"}
            </span>
          </li>
        `;
      }).join("")}
    </ol>
  `;
}

/** "Apakah jawaban ini membantu?" — or a thank-you once answered. */
function htmlPenilaian() {
  if (penilaian !== null) {
    return `<p class="text-[15px] leading-[22px] text-tinta-lembut" role="status">Terima kasih atas penilaianmu.</p>`;
  }
  return `
    <div class="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-2">
      <p class="flex-1 text-[15px] leading-[22px] font-medium text-tinta-isi">Apakah jawaban ini membantu?</p>
      <div class="flex gap-2">
        <button type="button" class="tombol-garis max-sm:flex-1 px-4 py-3 sm:py-2.5 leading-6" data-nilai="ya">
          ${ikon("thumbs-up", 18)} Ya
        </button>
        <button type="button" class="tombol-garis max-sm:flex-1 px-4 py-3 sm:py-2.5 leading-6" data-nilai="tidak">
          ${ikon("thumbs-down", 18)} Tidak
        </button>
      </div>
    </div>
  `;
}

/** Draw the result card for the current ticket (or nothing). */
function render() {
  if (!hasilTiket) {
    wadahHasil.innerHTML = "";
    return;
  }

  const t = hasilTiket;
  const sudahDijawab = t.status === "dijawab";

  const status = sudahDijawab
    ? `<p class="inline-flex items-center gap-1.5 bg-lengkap-muda text-lengkap-tua rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold">
         ${ikon("check-hijau", 14)} Sudah dijawab
       </p>`
    : `<p class="inline-flex items-center gap-1.5 bg-tiket text-tiket-tua rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold">
         ${ikon("clock-amber-14", 14)} Menunggu petugas
       </p>`;

  const jawaban = sudahDijawab
    ? `
      <div class="bg-cap-muda/60 border-l-4 border-cap rounded-xl px-4 py-4 lg:px-5 lg:py-[18px] flex flex-col gap-2.5">
        <div class="flex items-center gap-2.5">
          <span class="shrink-0 bg-white rounded-full size-8 flex items-center justify-center">${ikon("user-aksen", 18)}</span>
          <p class="flex-1 text-[15px] leading-[22px] font-bold text-cap-tua">Jawaban petugas Disdukcapil</p>
        </div>
        <p class="text-[17px] leading-7">${escapeHTML(t.jawaban)}</p>
        <p class="text-[13px] leading-[18px] text-tinta-lembut">Dijawab ${escapeHTML(formatTanggal(t.dijawabPada))}</p>
      </div>
      ${htmlPenilaian()}
    `
    : `
      <p class="bg-abu rounded-xl px-4 py-3.5 flex gap-2.5 items-start text-[15px] leading-6 text-tinta-isi">
        ${ikon("clock-abu", 16, "shrink-0 mt-1")}
        Petugas belum menjawab. Coba cek lagi nanti dengan kode yang sama.
      </p>
    `;

  wadahHasil.innerHTML = `
    <div class="muncul bg-white border border-garis rounded-2xl p-5 lg:p-7 flex flex-col gap-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        ${status}
        <p class="font-mono font-bold text-[15px] leading-[22px] text-tinta-lembut">${escapeHTML(t.kode)}</p>
      </div>
      ${t.dibuat ? htmlLinimasa(t) : ""}
      <div class="flex flex-col gap-1.5">
        <p class="text-sm leading-5 font-semibold text-tinta-lembut">Pertanyaanmu</p>
        <p class="text-[17px] leading-[26px]">${escapeHTML(t.pertanyaan)}</p>
      </div>
      ${jawaban}
    </div>
  `;
}

/* ==========================================================
   6. EVENT LISTENERS
   ========================================================== */

formTiket.addEventListener("submit", (e) => {
  e.preventDefault();
  const kode = rapikanKode(inputKode.value);

  if (!kode) {
    tampilkanGalat("Masukkan kode tiket dulu", "Kodenya ada di kartu tiket, misalnya TL-7K2QXM.");
    inputKode.focus();
    return;
  }

  inputKode.value = kode;
  cekTiket(kode);
});

inputKode.addEventListener("input", () => tampilkanGalat(""));

// Rating the officer's answer
wadahHasil.addEventListener("click", (e) => {
  const tombol = e.target.closest("button[data-nilai]");
  if (!tombol || !hasilTiket) return;

  penilaian = tombol.dataset.nilai === "ya";
  render();
  fetch("/api/penilaian", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layanan: `Jawaban petugas ${hasilTiket.kode}`, membantu: penilaian }),
  }).catch(() => {
    // A lost rating is not worth bothering the citizen about
  });
});

/* ==========================================================
   7. INITIALISE
   ========================================================== */

// Opened from the ticket card link: check straight away
const kodeDariUrl = rapikanKode(new URLSearchParams(location.search).get("kode") ?? "");
if (kodeDariUrl) {
  inputKode.value = kodeDariUrl;
  cekTiket(kodeDariUrl);
}
