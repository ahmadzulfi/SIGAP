/**
 * script.js — Tanya Layanan, halaman Tanya (Web 01–06, desain v2)
 *
 * Architecture:
 *   - percakapan[] : single source of truth, one entry ("giliran") per question
 *   - render()     : the only function that rebuilds conversation and panel HTML
 *   - Every change goes through ubah(), which bumps the entry's version so
 *     render() only rewrites entries that actually changed (no re-animating
 *     earlier answers, no lost checkbox focus).
 *   - Answers stream from POST /api/tanya as NDJSON stage events, so the
 *     "Proses" screen shows the server's real progress.
 */

"use strict";

/* ==========================================================
   1. STATE
   ========================================================== */

/**
 * @typedef {{
 *   id: string,
 *   tampil: string,
 *   permintaan: Record<string, string>,
 *   status: "proses" | "selesai" | "galat",
 *   langkah: number,
 *   judulLayanan: string,
 *   paket: boolean,
 *   hasil: Record<string, any> | null,
 *   pilihanDipilih: string | null,
 *   penilaian: boolean | null,
 *   waktuSelesai: number | null,
 *   versi: number,
 *   versiTampil: number,
 *   animasi: boolean
 * }} Giliran
 */

/** @type {Giliran[]} */
let percakapan = [];

/** True while a question is being answered (one at a time). */
let sedangMemproses = false;

/** Which entry + version the panel currently shows, to skip needless rebuilds. */
let panelTampil = "";

/** localStorage key: { [judulKb]: string[] } of checked requirement texts */
const KUNCI_CENTANG = "tanyalayanan_centang";

/** localStorage key: the citizen's region ("Kota Bandung", …) */
const KUNCI_WILAYAH = "tanyalayanan_wilayah";

/** Region the answers are for; "" until the citizen picks or names one. */
let wilayah = bacaWilayah();

/** Always offered after the AI's own options on an ask-back question. */
const PILIHAN_BELUM_TAHU = "Belum tahu";

/** The three stages of Web 02 (Proses). */
const TAHAP = [
  { judul: "Mencari layanan yang sesuai", keterangan: "Mencocokkan pertanyaanmu dengan daftar layanan" },
  { judul: "Menyusun daftar berkas dari dokumen resmi", keterangan: "Mencocokkan dengan standar pelayanan daerahmu" },
  { judul: "Mengecek ulang jawaban dengan dokumen", keterangan: "Supaya tidak ada berkas yang salah atau terlewat" },
];

/* ==========================================================
   2. DOM REFERENCES
   ========================================================== */

const tampilanBeranda    = document.getElementById("tampilan-beranda");
const tampilanPercakapan = document.getElementById("tampilan-percakapan");
const daftarPercakapan   = document.getElementById("percakapan");
const panel              = document.getElementById("panel");
const tplCakupan         = document.getElementById("tpl-cakupan");

// Phone-only sticky pill above the conversation
const lompatMap          = document.getElementById("lompat-map");
const teksLompatMap      = document.getElementById("teks-lompat-map");

// Beranda form
const formTanya      = document.getElementById("form-tanya");
const inputTanya     = document.getElementById("input-tanya");
const galatTanya     = document.getElementById("galat-tanya");
const tombolPeristiwa = document.querySelectorAll(".tombol-peristiwa");

// Follow-up form
const formLanjutan   = document.getElementById("form-lanjutan");
const kotakLanjutan  = document.getElementById("kotak-lanjutan");
const inputLanjutan  = document.getElementById("input-lanjutan");
const galatLanjutan  = document.getElementById("galat-lanjutan");

// Region indicator under the follow-up form
const infoWilayah    = document.getElementById("info-wilayah");
const namaWilayah    = document.getElementById("nama-wilayah");
const gantiWilayah   = document.getElementById("ganti-wilayah");

/* ==========================================================
   3. PERSISTENCE — checklist ticks (this device only)
   ========================================================== */

/**
 * Load all ticked requirements from localStorage.
 * @returns {Record<string, string[]>}
 */
function bacaCentang() {
  try {
    return JSON.parse(localStorage.getItem(KUNCI_CENTANG)) ?? {};
  } catch {
    // Corrupted or blocked storage — start fresh
    return {};
  }
}

/**
 * Load the remembered region.
 * @returns {string}
 */
function bacaWilayah() {
  try {
    return localStorage.getItem(KUNCI_WILAYAH) ?? "";
  } catch {
    return "";
  }
}

/**
 * Remember (or forget, with "") the citizen's region.
 * @param {string} nilai
 */
function simpanWilayah(nilai) {
  wilayah = nilai;
  try {
    if (nilai) localStorage.setItem(KUNCI_WILAYAH, nilai);
    else localStorage.removeItem(KUNCI_WILAYAH);
  } catch {
    // Private mode — the region lasts for this page only
  }
}

/**
 * Persist the ticked requirements of one service.
 * @param {string} judulKb
 * @param {string[]} tercentang
 */
function simpanCentang(judulKb, tercentang) {
  const semua = bacaCentang();
  semua[judulKb] = tercentang;
  try {
    localStorage.setItem(KUNCI_CENTANG, JSON.stringify(semua));
  } catch {
    // Private mode — ticks simply won't survive a reload
  }
}

/* ==========================================================
   4. UTILITY HELPERS
   ========================================================== */

/**
 * Sanitise a string to prevent XSS when inserted into the DOM.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML.replace(/"/g, "&quot;");
}

/**
 * Generate a unique ID string.
 * @returns {string}
 */
function generateId() {
  return `giliran-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** @returns {boolean} whether the visitor prefers less motion */
function kurangiGerak() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Validate a question before sending it.
 * @param {string} teks — already trimmed
 * @returns {string} error message, or "" when the question is fine
 */
function cekIsian(teks) {
  if (!teks) return "Tulis dulu pertanyaanmu.";
  if (/\d{16}/.test(teks)) {
    return "Sepertinya ada NIK di pertanyaanmu. Hapus dulu supaya datamu aman.";
  }
  return "";
}

/**
 * Show or hide an inline validation message.
 * @param {HTMLElement} el
 * @param {string} pesan — empty string hides the message
 */
function tampilkanGalat(el, pesan) {
  el.textContent = pesan;
  el.classList.toggle("hidden", !pesan);
}

/**
 * Temporarily swap a button's label, e.g. "Salin daftar" → "Tersalin".
 * Only the .label-tombol text changes, so the button's icon stays.
 * @param {HTMLButtonElement} tombol
 * @param {string} teks
 */
function tandaiTombol(tombol, teks) {
  const label = tombol.querySelector(".label-tombol") ?? tombol;
  const asli = tombol.dataset.labelAsli ?? label.textContent;
  tombol.dataset.labelAsli = asli;
  label.textContent = teks;
  setTimeout(() => {
    label.textContent = asli;
  }, 2000);
}

/**
 * Copy text to the clipboard and confirm on the button.
 * @param {string} teks
 * @param {HTMLButtonElement} tombol
 */
async function salin(teks, tombol) {
  try {
    await navigator.clipboard.writeText(teks);
    tandaiTombol(tombol, "Tersalin");
  } catch {
    tandaiTombol(tombol, "Gagal menyalin");
  }
}

/**
 * Lower-case the first letter for use mid-sentence, unless the first word
 * is an acronym ("SIM", "BPJS Kesehatan").
 * @param {string} str
 * @returns {string}
 */
function hurufKecilAwal(str) {
  const kataPertama = str.split(" ")[0];
  if (kataPertama.length > 1 && kataPertama === kataPertama.toUpperCase()) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

/* ==========================================================
   5. STATE CHANGES
   ========================================================== */

/**
 * Apply changes to an entry and mark it for re-rendering.
 * @param {Giliran} giliran
 * @param {Partial<Giliran>} perubahan
 */
function ubah(giliran, perubahan) {
  Object.assign(giliran, perubahan);
  giliran.versi += 1;
}

/**
 * @param {string} id
 * @returns {Giliran | undefined}
 */
function cariGiliran(id) {
  return percakapan.find((g) => g.id === id);
}

/**
 * The knowledge base title of the latest answered service, sent with
 * follow-up questions so "kalau beda kota?" keeps its context.
 * @returns {string}
 */
function layananTerakhir() {
  for (let i = percakapan.length - 1; i >= 0; i--) {
    const judul = percakapan[i].hasil?.judulKb;
    if (judul) return judul;
  }
  return "";
}

/* ==========================================================
   6. ASKING — POST /api/tanya (NDJSON stream)
   ========================================================== */

/**
 * Read a newline-delimited JSON stream, yielding one object per line.
 * @param {Response} response
 * @returns {AsyncGenerator<Record<string, any>>}
 */
async function* bacaAliran(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let sisa = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sisa += value;
    const baris = sisa.split("\n");
    sisa = baris.pop();
    for (const b of baris) {
      if (b.trim()) yield JSON.parse(b);
    }
  }
  if (sisa.trim()) yield JSON.parse(sisa);
}

/**
 * Add a question to the conversation and stream its answer.
 * @param {string} tampil — text shown in the citizen's bubble
 * @param {Record<string, string>} permintaan — body for /api/tanya
 */
async function kirimPertanyaan(tampil, permintaan) {
  if (sedangMemproses) return;

  /** @type {Giliran} */
  const giliran = {
    id: generateId(),
    tampil,
    permintaan,
    status: "proses",
    langkah: 0,
    judulLayanan: "",
    paket: false,
    hasil: null,
    pilihanDipilih: null,
    penilaian: null,
    waktuSelesai: null,
    versi: 0,
    versiTampil: -1,
    animasi: false,
  };

  percakapan.push(giliran);
  sedangMemproses = true;
  tampilanBeranda.classList.add("hidden");
  tampilanPercakapan.classList.remove("hidden");
  render();

  document.getElementById(giliran.id).scrollIntoView({
    behavior: kurangiGerak() ? "auto" : "smooth",
    block: "start",
  });

  try {
    const response = await fetch("/api/tanya", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...permintaan, wilayah: permintaan.wilayah ?? wilayah }),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

    for await (const peristiwa of bacaAliran(response)) {
      if (peristiwa.tahap === "layanan") {
        ubah(giliran, { langkah: 1, judulLayanan: peristiwa.judul, paket: Boolean(peristiwa.paket) });
      } else if (peristiwa.tahap === "mengecek") {
        ubah(giliran, { langkah: 2 });
      } else if (peristiwa.hasil) {
        // The server may have recognised the region from the question ("warga Soreang")
        if (peristiwa.hasil.wilayah) simpanWilayah(peristiwa.hasil.wilayah);
        ubah(giliran, { status: "selesai", hasil: peristiwa.hasil, waktuSelesai: Date.now(), animasi: true });
      } else if (peristiwa.galat) {
        ubah(giliran, { status: "galat", animasi: true });
      }
      render();
    }

    // Stream ended without a result
    if (giliran.status === "proses") ubah(giliran, { status: "galat", animasi: true });
  } catch {
    ubah(giliran, { status: "galat", animasi: true });
  }

  sedangMemproses = false;
  render();

  // Move focus to the new answer's heading so screen readers announce it
  document.querySelector(`#${giliran.id} .judul-jawaban`)?.focus({ preventScroll: true });
}

/* ==========================================================
   7. RENDER — conversation pieces (return HTML strings)
   ========================================================== */

/** Lucide icon from assets/ikon at its native size. */
function ikon(nama, ukuran, kelas = "shrink-0") {
  return `<img src="assets/ikon/${nama}.svg" width="${ukuran}" height="${ukuran}" alt="" class="${kelas}" />`;
}

/**
 * Citizen's message bubble (right-aligned).
 * @param {string} teks
 * @returns {string}
 */
function htmlPesanWarga(teks) {
  return `
    <div class="flex flex-col items-end gap-1.5 muncul">
      <p class="text-[13px] leading-[18px] font-semibold text-tinta-lembut">Kamu</p>
      <p class="max-w-[85%] lg:max-w-[560px] bg-tinta text-white rounded-2xl rounded-tr-[4px] px-4 py-3 lg:px-5 lg:py-3.5">
        ${escapeHTML(teks)}
      </p>
    </div>
  `;
}

/** Status badges in the answer card header: always icon + text, never colour alone. */
const BADGE = {
  dicek: {
    kelas: "bg-lengkap-muda text-lengkap-tua",
    ikon: "check-hijau",
    teks: `<span class="lg:hidden">Dicek ulang</span><span class="hidden lg:inline">Sudah dicek ulang dengan dokumen</span>`,
  },
  proses: { kelas: "bg-cap-muda text-cap-tua", ikon: "", teks: "Sedang memproses" },
  tanya: { kelas: "bg-cap-muda text-cap-tua", ikon: "help-aksen", teks: "Butuh 1 info lagi" },
  luar: { kelas: "bg-abu text-tinta-isi", ikon: "info-tinta", teks: "Di luar layanan Disdukcapil" },
  teruskan: { kelas: "bg-tiket text-tiket-tua", ikon: "user-amber", teks: "Diteruskan ke petugas" },
  galat: { kelas: "bg-galat-muda text-galat-tua", ikon: "", teks: "Belum berhasil" },
};

/**
 * "Tanya Layanan" header with a status badge.
 * @param {keyof typeof BADGE} jenis
 * @returns {string}
 */
function htmlKepalaJawaban(jenis) {
  const b = BADGE[jenis];
  return `
    <div class="flex flex-wrap items-center gap-x-2.5 lg:gap-x-3 gap-y-2">
      <span class="shrink-0 bg-cap rounded-[9px] lg:rounded-[10px] size-8 lg:size-9 flex items-center justify-center">
        ${ikon("shield-check-hp", 18, "lg:hidden")}${ikon("shield-check-20", 20, "hidden lg:block")}
      </span>
      <p class="text-[15px] leading-[22px] font-bold">Tanya Layanan</p>
      <p class="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold ${b.kelas}">
        ${b.ikon ? ikon(b.ikon, 14) : ""}${b.teks}
      </p>
    </div>
  `;
}

/**
 * White answer card that wraps every kind of reply.
 * @param {Giliran} g
 * @param {keyof typeof BADGE} jenis
 * @param {string} isi
 * @param {string} [jarak] — gap between blocks
 * @returns {string}
 */
function htmlKartuJawaban(g, jenis, isi, jarak = "gap-5") {
  return `
    <article class="bg-white border border-garis rounded-2xl p-5 lg:p-7 flex flex-col ${jarak} ${g.animasi ? "muncul" : ""}">
      ${htmlKepalaJawaban(jenis)}
      ${isi}
    </article>
  `;
}

/** Answer card heading; focused after the answer arrives so screen readers announce it. */
function htmlJudulJawaban(teks, ukuran = "lg:text-[26px] lg:leading-[34px]") {
  return `<h2 tabindex="-1" class="judul-jawaban font-judul font-bold text-2xl leading-8 ${ukuran}">${teks}</h2>`;
}

/**
 * Numbered steps (Cara mengurus, Apa selanjutnya).
 * @param {string[]} langkah — already escaped HTML
 * @returns {string}
 */
function htmlLangkah(langkah) {
  return `
    <ol class="flex flex-col gap-3 lg:gap-3.5">
      ${langkah.map((teks, i) => `
        <li class="flex gap-3 lg:gap-3.5 items-start">
          <span class="shrink-0 bg-cap-muda text-cap rounded-full size-[26px] lg:size-7 flex items-center justify-center
                       text-[13px] leading-[18px] lg:text-sm lg:leading-5 font-bold">${i + 1}</span>
          <span class="flex-1 text-[15px] leading-6 lg:text-base lg:leading-[26px]">${teks}</span>
        </li>
      `).join("")}
    </ol>
  `;
}

/** "panel kanan" on desktop, "bawah" on phones, where the panel sits under the answer. */
const LETAK_PANEL = `<span class="hidden lg:inline">panel kanan</span><span class="lg:hidden">bawah</span>`;

/**
 * Web 02 — stages while the answer is being prepared.
 * @param {Giliran} g
 * @returns {string}
 */
function htmlProses(g) {
  const tahap = TAHAP.map((t, i) => {
    const keadaan = i < g.langkah ? "selesai" : i === g.langkah ? "aktif" : "tunggu";
    const terakhir = i === TAHAP.length - 1;
    const judulSelesai = g.paket ? "Rencana layanan disusun" : "Layanan ditemukan";
    const judul = i === 0 && keadaan === "selesai" ? judulSelesai
      : i === 1 && g.paket ? "Menyusun daftar berkas tiap layanan sekaligus"
      : t.judul;
    const keterangan = i === 0 && keadaan === "selesai" ? g.judulLayanan : t.keterangan;
    const keteranganSr = { selesai: "Selesai", aktif: "Sedang berjalan", tunggu: "Menunggu" }[keadaan];
    const ikonTahap = {
      selesai: ikon("check-circle", 24),
      aktif: ikon("loader", 24, "shrink-0 putar"),
      tunggu: ikon("circle", 24),
    }[keadaan];

    return `
      <li class="flex gap-3.5 items-stretch">
        <span class="shrink-0 flex flex-col items-center gap-1" aria-hidden="true">
          ${ikonTahap}
          ${terakhir ? "" : `<span class="flex-1 w-0.5 ${keadaan === "selesai" ? "bg-lengkap" : "bg-garis"}"></span>`}
        </span>
        <span class="flex-1 flex flex-col gap-0.5 ${terakhir ? "" : "pb-5"}">
          <span class="${keadaan === "tunggu" ? "font-medium text-tinta-lembut" : "font-bold"}">
            <span class="sr-only">${keteranganSr}: </span>${escapeHTML(judul)}
          </span>
          <span class="text-sm leading-5 text-tinta-lembut">${escapeHTML(keterangan)}</span>
        </span>
      </li>
    `;
  }).join("");

  return htmlKartuJawaban(g, "proses", `
    <h2 class="font-judul font-bold text-2xl leading-8 lg:text-[26px] lg:leading-[34px]">Sebentar, jawabanmu sedang disiapkan</h2>
    <ol class="flex flex-col" aria-busy="true">${tahap}</ol>
    <p class="self-start bg-abu rounded-[10px] px-3.5 py-2.5 flex items-center gap-2 text-sm leading-5 text-tinta-isi">
      ${ikon("clock-abu", 16)}
      ${g.paket ? "Beberapa layanan disiapkan sekaligus, biasanya 20–40 detik." : "Biasanya butuh 10–20 detik."} Jangan tutup halaman ini.
    </p>
  `);
}

/** Icon for each service info row from infoLayanan() on the server. */
const IKON_INFO = { Tempat: "map-pin", Biaya: "banknote", "Lama proses": "clock-abu" };

/**
 * Web 03 — answer with steps, service info, source and rating.
 * @param {Giliran} g
 * @param {Record<string, any>} h — hasil
 * @returns {string}
 */
function htmlJawaban(g, h) {
  const pembuka = h.berkas.length
    ? `Berkas yang perlu dibawa ada di ${LETAK_PANEL}. Centang yang sudah kamu siapkan supaya tidak ada yang tertinggal.`
    : escapeHTML(h.pembuka);

  const caraMengurus = h.caraMengurus.length
    ? `
      <section class="flex flex-col gap-3 lg:gap-3.5">
        <h3 class="font-judul font-bold text-lg leading-[26px] lg:text-xl lg:leading-7">Cara mengurus</h3>
        ${htmlLangkah(h.caraMengurus.map(escapeHTML))}
      </section>
    `
    : "";

  const isi = `
    <div class="flex flex-col gap-2">
      ${htmlJudulJawaban(escapeHTML(h.judulLayanan), "lg:text-[28px] lg:leading-9")}
      <p class="leading-[26px] lg:text-[17px] lg:leading-7 text-tinta-isi">${pembuka}</p>
    </div>

    ${caraMengurus}
    ${htmlInfoLayanan(h.info)}

    <div class="border-t border-garis pt-3.5 lg:pt-4">${htmlSumber(h.sumber)}</div>

    ${htmlPenilaian(g)}
  `;

  return htmlKartuJawaban(g, "dicek", isi, "gap-5 lg:gap-6");
}

/**
 * Place / cost / duration tiles from infoLayanan() on the server.
 * @param {{ label: string, isi: string }[]} info
 * @returns {string}
 */
function htmlInfoLayanan(info) {
  if (!info.length) return "";
  return `
    <dl class="grid sm:grid-cols-2 gap-2 sm:gap-3">
      ${info.map((baris) => {
        const namaIkon = IKON_INFO[baris.label];
        return `
          <div class="bg-abu rounded-xl px-3.5 py-3 lg:p-4 flex gap-3 items-start">
            ${namaIkon ? `<span class="shrink-0 size-5 flex items-center justify-center">${ikon(namaIkon, namaIkon === "clock-abu" ? 16 : 20)}</span>` : ""}
            <div class="flex-1 min-w-0 flex flex-col gap-0.5">
              <dt class="text-[13px] leading-[18px] font-semibold text-tinta-lembut">${escapeHTML(baris.label)}</dt>
              <dd class="text-[15px] leading-[22px] lg:text-base lg:leading-6 font-bold">${escapeHTML(baris.isi)}</dd>
            </div>
          </div>
        `;
      }).join("")}
    </dl>
  `;
}

/**
 * "Sumber: …" line with the document's date note.
 * @param {{ teks: string, url: string, catatan: string }} sumber
 * @returns {string}
 */
function htmlSumber(sumber) {
  // Only link to https URLs that came from the knowledge base
  const sumberUrl = /^https:\/\//.test(sumber.url) ? sumber.url : "";
  const sumberTeks = `Sumber: ${escapeHTML(sumber.teks)}`;
  const kelasSumber = "text-sm leading-5 lg:text-[15px] lg:leading-[22px] font-semibold text-cap underline";

  return `
    <div class="flex gap-2.5 lg:gap-3 items-start">
      ${ikon("file-text-aksen-hp", 18, "shrink-0 mt-px lg:hidden")}${ikon("file-text-aksen", 20, "shrink-0 mt-px hidden lg:block")}
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        ${sumberUrl
          ? `<a href="${escapeHTML(sumberUrl)}" target="_blank" rel="noopener" class="${kelasSumber}">${sumberTeks}</a>`
          : `<p class="${kelasSumber} no-underline">${sumberTeks}</p>`}
        <p class="text-[13px] leading-[18px] lg:text-sm lg:leading-5 text-tinta-lembut">${escapeHTML(sumber.catatan)}</p>
      </div>
    </div>
  `;
}

/**
 * "Apakah informasi ini membantu?" — or a thank-you once answered.
 * @param {Giliran} g
 * @returns {string}
 */
function htmlPenilaian(g) {
  if (g.penilaian !== null) {
    return `<p class="tidak-dicetak text-[15px] leading-[22px] text-tinta-lembut" role="status">Terima kasih atas penilaianmu.</p>`;
  }
  return `
    <div class="tidak-dicetak flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-2">
      <p class="flex-1 text-[15px] leading-[22px] font-medium text-tinta-isi">Apakah informasi ini membantu?</p>
      <div class="flex gap-2">
        <button type="button" class="tombol-garis max-sm:flex-1 px-4 py-3 sm:py-2.5 leading-6" data-nilai="ya" data-giliran="${g.id}">
          ${ikon("thumbs-up", 18)} Ya
        </button>
        <button type="button" class="tombol-garis max-sm:flex-1 px-4 py-3 sm:py-2.5 leading-6" data-nilai="tidak" data-giliran="${g.id}">
          ${ikon("thumbs-down", 18)} Tidak
        </button>
      </div>
    </div>
  `;
}

/**
 * Web 04 — AI asks one question first.
 * @param {Giliran} g
 * @param {Record<string, any>} h
 * @returns {string}
 */
function htmlTanyaBalik(g, h) {
  // "Belum tahu" makes no sense when asking which region the citizen lives in
  const daftar = h.tanyaWilayah ? h.pilihan : [...h.pilihan, PILIHAN_BELUM_TAHU];
  const pilihan = daftar.map((p) => {
    const dipilih = g.pilihanDipilih === p;
    return `
      <button type="button"
        class="tombol-pilihan w-full text-left px-[18px] py-4 flex items-center gap-3.5"
        data-giliran="${g.id}"
        data-pilihan="${escapeHTML(p)}"
        aria-pressed="${dipilih}"
        ${g.pilihanDipilih ? "disabled" : ""}
      >
        ${ikon("radio", 20, "radio-mati shrink-0")}
        ${ikon("radio-aktif", 20, "radio-nyala shrink-0")}
        <span class="flex-1 font-semibold text-[17px] leading-[26px]">${escapeHTML(p)}</span>
      </button>
    `;
  }).join("");

  return htmlKartuJawaban(g, "tanya", `
    <div class="flex flex-col gap-2">
      ${htmlJudulJawaban("Satu pertanyaan dulu supaya daftarnya tepat")}
      <p class="text-[17px] leading-7 lg:text-lg text-tinta-isi">${escapeHTML(h.pertanyaanBalik)}</p>
    </div>
    <div class="flex flex-col gap-2.5" role="group" aria-label="Pilihan jawaban">${pilihan}</div>
    ${h.alasan
      ? `<p class="flex gap-2 items-start text-sm leading-[22px] text-tinta-lembut">
           ${ikon("info-lembut", 18, "shrink-0 mt-0.5")}${escapeHTML(h.alasan)}
         </p>`
      : ""}
  `);
}

/**
 * Web 05 — not a Disdukcapil service; point to the right agency.
 * @param {Giliran} g
 * @param {Record<string, any>} h
 * @returns {string}
 */
function htmlLuarCakupan(g, h) {
  const situs = h.situs
    ? `<a href="${escapeHTML(h.situs.url)}" target="_blank" rel="noopener"
         class="tombol-utama self-start px-5 py-3 leading-6">
         Buka situs resmi ${escapeHTML(h.situs.nama)}
         ${ikon("external", 18)}
       </a>`
    : "";

  return htmlKartuJawaban(g, "luar", `
    <div class="flex flex-col gap-2">
      ${htmlJudulJawaban(`${escapeHTML(h.layanan)} bukan layanan Disdukcapil`)}
      <p class="leading-[26px] lg:text-[17px] lg:leading-7 text-tinta-isi">
        Kamu tidak perlu ke Disdukcapil untuk ini. ${escapeHTML(h.layanan)} diurus oleh instansi lain.
      </p>
    </div>
    <div class="bg-cap-muda border border-cap-garis rounded-xl p-4 lg:p-5 flex flex-col gap-4">
      <div class="flex gap-3.5 items-center">
        <span class="shrink-0 bg-white rounded-xl size-12 flex items-center justify-center">${ikon("landmark", 24)}</span>
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <p class="text-xs leading-4 font-bold tracking-[0.72px] uppercase text-cap-tua">Diurus oleh</p>
          <p class="font-judul font-bold text-xl leading-7">${escapeHTML(h.instansi)}</p>
          ${h.instansiInduk ? `<p class="text-[15px] leading-[22px] text-tinta-isi">${escapeHTML(h.instansiInduk)}</p>` : ""}
        </div>
      </div>
      ${situs}
    </div>
    <p class="flex gap-2 items-start text-sm leading-[22px] text-tinta-lembut">
      ${ikon("info-lembut", 18, "shrink-0 mt-0.5")}
      Pertanyaan ini tidak diteruskan ke petugas, karena petugas Disdukcapil tidak menangani
      ${escapeHTML(hurufKecilAwal(h.layanan))}.
    </p>
  `);
}

/**
 * Web 06 — forwarded to an officer.
 * @param {Giliran} g
 * @returns {string}
 */
function htmlTeruskan(g) {
  return htmlKartuJawaban(g, "teruskan", `
    <div class="flex flex-col gap-2">
      ${htmlJudulJawaban("Pertanyaanmu aku teruskan ke petugas")}
      <p class="leading-[26px] lg:text-[17px] lg:leading-7 text-tinta-isi">
        Keadaan ini belum tercantum di standar pelayanan, jadi aku tidak mau menebak. Petugas Disdukcapil
        akan menjawab, dan kamu bisa melihat jawabannya dengan kode tiket.
      </p>
    </div>
    <section class="border-t border-garis pt-4 flex flex-col gap-3">
      <h3 class="font-judul font-bold text-lg leading-[26px]">Apa selanjutnya</h3>
      ${htmlLangkah([
        `Simpan kode tiket di ${LETAK_PANEL} (salin atau foto layar).`,
        "Petugas Disdukcapil membaca dan menjawab pertanyaanmu.",
        "Buka halaman Cek tiket, masukkan kodenya, lalu baca jawabannya.",
      ])}
    </section>
  `);
}

/** Status chip of one package step: always icon + text, never colour alone. */
const STATUS_LANGKAH = {
  siap: { kelas: "bg-lengkap-muda text-lengkap-tua", ikon: "check-hijau", teks: "Dicek dengan dokumen" },
  teruskan: { kelas: "bg-tiket text-tiket-tua", ikon: "user-amber", teks: "Ditanyakan ke petugas" },
  luar: { kelas: "bg-abu text-tinta-isi", ikon: "info-tinta", teks: "Di luar Bandung Raya" },
  galat: { kelas: "bg-galat-muda text-galat-tua", ikon: "", teks: "Belum bisa disiapkan" },
};

/**
 * One step of a package: service, why, what it needs, and its details.
 * @param {Record<string, any>} h — the whole package
 * @param {Record<string, any>} l — one entry of h.langkah
 * @returns {string}
 */
function htmlLangkahPaket(h, l) {
  const s = STATUS_LANGKAH[l.status] ?? STATUS_LANGKAH.galat;
  const terakhir = l.urutan === h.langkah.length;
  const wilayahLain = l.wilayah && l.wilayah !== h.wilayah;

  const butuh = l.butuh.map((n) => {
    const asal = h.langkah[n - 1];
    return asal?.menghasilkan ? `${asal.menghasilkan} dari langkah ${n}` : `hasil langkah ${n}`;
  });

  let isi = "";
  if (l.status === "siap") {
    const rincian = [
      l.caraMengurus.length
        ? `<section class="flex flex-col gap-3"><h4 class="font-bold text-[15px] leading-[22px]">Cara mengurus</h4>${htmlLangkah(l.caraMengurus.map(escapeHTML))}</section>`
        : "",
      htmlInfoLayanan(l.info),
      l.sumber ? htmlSumber(l.sumber) : "",
    ].filter(Boolean).join("");

    isi = `
      <p class="text-sm leading-5 text-tinta-lembut">
        ${l.jumlahBerkas} berkas, sudah masuk daftar gabungan di ${LETAK_PANEL}.
      </p>
      ${rincian
        ? `<details class="group border border-garis rounded-xl">
             <summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 py-3 flex items-center justify-between gap-3 font-semibold text-[15px] leading-[22px]">
               Cara mengurus, tempat, dan sumber
               ${ikon("chevron-down", 18, "shrink-0 transition-transform group-open:rotate-180")}
             </summary>
             <div class="px-4 pb-4 flex flex-col gap-4">${rincian}</div>
           </details>`
        : ""}
    `;
  } else if (l.status === "teruskan") {
    const sebab = l.kategori === "tidak_diatur"
      ? `Layanan ini belum diatur di dokumen resmi ${escapeHTML(l.wilayah)}, jadi aku tidak menebak berkasnya.`
      : "Aku belum yakin dengan berkas layanan ini, jadi aku tidak menebak.";
    isi = `
      <div class="bg-tiket rounded-xl px-4 py-3 flex flex-col gap-1.5 text-[15px] leading-[22px] text-tinta-isi">
        <p>${sebab} Pertanyaannya sudah aku teruskan ke petugas.</p>
        <p>
          Kode tiket <span class="font-mono font-bold text-tinta">${escapeHTML(l.kode)}</span> ·
          <a href="cek-tiket.html?kode=${encodeURIComponent(l.kode)}" class="font-bold text-cap underline">Cek tiket</a>
        </p>
      </div>
    `;
  } else if (l.status === "luar") {
    const tempat = /tujuan/i.test(l.wilayah) ? "daerah tujuanmu" : escapeHTML(l.wilayah);
    isi = `
      <p class="bg-abu rounded-xl px-4 py-3 text-[15px] leading-[22px] text-tinta-isi">
        Diurus di Disdukcapil ${tempat}. Persyaratannya tidak ada di dokumen Bandung Raya yang aku pegang,
        jadi tanyakan langsung ke sana.
      </p>
    `;
  } else {
    isi = `
      <p class="text-[15px] leading-[22px] text-tinta-isi">
        Daftar berkasnya belum bisa disiapkan. Coba tanyakan layanan ini sendiri, misalnya
        "Syarat ${escapeHTML(hurufKecilAwal(l.layanan))} di ${escapeHTML(l.wilayah)} apa?"
      </p>
    `;
  }

  return `
    <li class="flex gap-3.5 items-stretch">
      <span class="shrink-0 flex flex-col items-center gap-1" aria-hidden="true">
        <span class="bg-cap-muda text-cap rounded-full size-8 flex items-center justify-center font-bold text-[15px]">${l.urutan}</span>
        ${terakhir ? "" : `<span class="flex-1 w-0.5 bg-garis"></span>`}
      </span>
      <div class="flex-1 min-w-0 flex flex-col gap-2 ${terakhir ? "" : "pb-6"}">
        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h3 class="font-judul font-bold text-lg leading-[26px] lg:text-xl lg:leading-7">
            <span class="sr-only">Langkah ${l.urutan}: </span>${escapeHTML(l.layanan)}
          </h3>
          <p class="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold ${s.kelas}">
            ${s.ikon ? ikon(s.ikon, 14) : ""}${s.teks}
          </p>
        </div>
        ${wilayahLain ? `<p class="flex items-center gap-1.5 text-sm leading-5 font-semibold text-tinta-isi">${ikon("map-pin", 16)}${escapeHTML(l.wilayah)}</p>` : ""}
        ${l.alasan ? `<p class="text-[15px] leading-6 text-tinta-isi">${escapeHTML(l.alasan)}</p>` : ""}
        ${butuh.length
          ? `<p class="flex gap-2 items-start text-sm leading-5 text-tinta-lembut">${ikon("arrow-right-abu", 16, "shrink-0 mt-0.5")}Butuh ${escapeHTML(butuh.join(" dan "))}</p>`
          : ""}
        ${l.catatan
          ? `<p class="flex gap-2 items-start text-sm leading-5 text-tinta-lembut">${ikon("info-lembut", 16, "shrink-0 mt-0.5")}Berkas bergantung keadaanmu: ${escapeHTML(l.catatan)}</p>`
          : ""}
        ${isi}
      </div>
    </li>
  `;
}

/**
 * Life-event package: the services in order, each checked against its document.
 * @param {Giliran} g
 * @param {Record<string, any>} h
 * @returns {string}
 */
function htmlPaket(g, h) {
  const adaBerkas = h.berkas.length || h.didapat.length;
  const pembuka = `Urus dari atas ke bawah, karena dokumen dari satu langkah jadi syarat langkah berikutnya.${
    adaBerkas ? ` Semua berkasnya sudah aku gabung tanpa dobel di ${LETAK_PANEL}.` : ""
  }`;

  return htmlKartuJawaban(g, "dicek", `
    <div class="flex flex-col gap-2">
      <p class="text-xs leading-4 font-bold tracking-[0.72px] uppercase text-cap-tua">
        Paket peristiwa hidup · ${escapeHTML(h.wilayah)}
      </p>
      ${htmlJudulJawaban(escapeHTML(h.judulLayanan), "lg:text-[28px] lg:leading-9")}
      <p class="leading-[26px] lg:text-[17px] lg:leading-7 text-tinta-isi">${pembuka}</p>
    </div>
    <ol class="flex flex-col">${h.langkah.map((l) => htmlLangkahPaket(h, l)).join("")}</ol>
    ${htmlPenilaian(g)}
  `, "gap-5 lg:gap-6");
}

/**
 * Something went wrong (Langflow down, invalid AI output…).
 * @param {Giliran} g
 * @returns {string}
 */
function htmlGalat(g) {
  return htmlKartuJawaban(g, "galat", `
    <div class="flex flex-col gap-2">
      ${htmlJudulJawaban("Maaf, jawaban belum bisa disiapkan")}
      <p class="leading-[26px] lg:text-[17px] lg:leading-7 text-tinta-isi">
        Sistem sedang bermasalah. Coba tanyakan lagi sebentar lagi, atau hubungi Disdukcapil lewat kanal
        resmi di bagian bawah halaman.
      </p>
    </div>
    <button type="button" data-ulang="${g.id}"
      class="tidak-dicetak tombol-garis self-start px-5 py-2.5 leading-6">
      Coba lagi
    </button>
  `);
}

/**
 * Everything below the bubble for one entry.
 * @param {Giliran} g
 * @returns {string}
 */
function htmlIsi(g) {
  if (g.status === "proses") return htmlProses(g);
  if (g.status === "galat") return htmlGalat(g);

  const h = g.hasil;
  switch (h.jenis) {
    case "jawaban":
      return htmlJawaban(g, h);
    case "tanya_balik":
      return htmlTanyaBalik(g, h);
    case "luar_cakupan":
      return htmlLuarCakupan(g, h);
    case "teruskan":
      return htmlTeruskan(g);
    case "paket":
      return htmlPaket(g, h);
    default:
      return htmlGalat(g);
  }
}

/* ==========================================================
   8. RENDER — right-hand panel ("Kolom map")
   ========================================================== */

/** "Yang bisa ditanyakan di sini" card (Web 05, general info). */
function htmlPanelCakupan() {
  return tplCakupan.innerHTML;
}

/** "YANG PERLU DIBAWA" header of the checklist card. */
function htmlJudulMap(judul = "") {
  return `
    <div class="flex gap-3 items-start">
      <span class="shrink-0 bg-lengkap-muda rounded-[10px] size-10 flex items-center justify-center">${ikon("folder", 20)}</span>
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <p class="text-xs leading-4 font-bold tracking-[0.72px] uppercase text-tinta-lembut">Yang perlu dibawa</p>
        ${judul ? `<h2 id="judul-map" class="font-judul font-bold text-lg leading-6 lg:text-[19px] lg:leading-[26px]">${judul}</h2>` : ""}
      </div>
    </div>
  `;
}

/** Skeleton while the checklist is being prepared (Web 02). */
function htmlPanelKerangka() {
  const baris = ["w-[300px]", "w-[250px]", "w-[320px]", "w-[220px]"].map((lebar) => `
    <div class="border-b border-garis py-3.5 flex items-center gap-3.5">
      <div class="bg-kerangka rounded-md size-6 shrink-0"></div>
      <div class="bg-kerangka rounded-md h-3.5 max-w-full ${lebar}"></div>
    </div>
  `).join("");

  return `
    <div class="bg-white border border-garis rounded-2xl p-5 lg:p-6 flex flex-col gap-4">
      ${htmlJudulMap()}
      <div aria-hidden="true" class="flex flex-col gap-4">
        <div class="bg-kerangka rounded-md h-6 w-[300px] max-w-full"></div>
        <div class="bg-kerangka rounded-md h-3 w-[120px]"></div>
        <div>${baris}</div>
      </div>
      <p class="text-[13px] leading-5 text-tinta-lembut">Daftar muncul di sini setelah dicek ulang.</p>
    </div>
  `;
}

/**
 * "X dari Y siap" progress label.
 * @param {number} siap
 * @param {number} total
 * @returns {string}
 */
function teksProgres(siap, total) {
  return `${siap} dari ${total} siap`;
}

/** @returns {number} whole percentage, 0 when there is nothing to prepare */
function persenProgres(siap, total) {
  return total ? Math.round((siap / total) * 100) : 0;
}

/**
 * Checklist of requirements (Web 03), or a provisional one while the AI asks back (Web 04).
 * @param {Record<string, any>} h
 * @param {{ sementara: boolean }} opsi
 * @returns {string}
 */
function htmlPanelMap(h, { sementara }) {
  const tercentang = new Set(bacaCentang()[h.judulKb] ?? []);
  const siap = h.berkas.filter((b) => tercentang.has(b)).length;
  const persen = persenProgres(siap, h.berkas.length);

  // A package says which steps need each document ("Langkah 1 · 2")
  const items = h.berkas.map((teks, i) => `
    <li class="item-berkas border-b border-garis">
      <label class="flex gap-3.5 items-start px-1 py-3.5 ${sementara ? "" : "cursor-pointer"}">
        <input type="checkbox" class="centang"
          value="${escapeHTML(teks)}"
          ${tercentang.has(teks) ? "checked" : ""}
          ${sementara ? "disabled" : ""} />
        <span class="flex-1 min-w-0 flex flex-col gap-0.5">
          <span class="teks-berkas">${escapeHTML(teks)}</span>
          ${h.berkasLangkah
            ? `<span class="text-[13px] leading-[18px] font-semibold text-tinta-lembut">Langkah ${h.berkasLangkah[i].join(" · ")}</span>`
            : ""}
        </span>
      </label>
    </li>
  `).join("");

  // Documents an earlier step hands over: nothing to prepare for them yet
  const didapat = h.didapat?.length
    ? `
      <section class="bg-abu rounded-xl p-4 flex flex-col gap-2.5" aria-labelledby="judul-didapat">
        <h3 id="judul-didapat" class="text-[13px] leading-[18px] font-bold tracking-[0.52px] uppercase text-tinta-lembut">
          Tidak perlu disiapkan sekarang
        </h3>
        <ul class="flex flex-col gap-2">
          ${h.didapat.map((d) => `
            <li class="flex gap-2.5 items-start text-[15px] leading-[22px]">
              ${ikon("arrow-right-abu", 16, "shrink-0 mt-[3px]")}
              <span class="flex-1 min-w-0">
                ${escapeHTML(d.teks)}
                <span class="block text-[13px] leading-[18px] text-tinta-lembut">
                  Didapat dari langkah ${d.dari}, dipakai di langkah ${d.untuk.join(" · ")}
                </span>
              </span>
            </li>
          `).join("")}
        </ul>
      </section>
    `
    : "";

  const status = sementara
    ? `
      <p class="bg-tiket rounded-lg px-3 py-2 flex items-center gap-2 text-sm leading-5 font-semibold text-tiket-tua">
        ${ikon("clock-amber", 16)}
        Daftar sementara, menunggu jawabanmu
      </p>
    `
    : `
      <div class="flex flex-col gap-2">
        <div class="flex items-start justify-between gap-3 leading-[22px]">
          <p id="progres-map" class="text-[15px] font-bold text-lengkap" aria-live="polite">${teksProgres(siap, h.berkas.length)}</p>
          <p id="persen-map" class="text-sm font-semibold text-tinta-lembut" aria-hidden="true">${persen}%</p>
        </div>
        <div class="bg-garis h-2 rounded-full overflow-hidden" aria-hidden="true">
          <div id="bar-map" class="bg-lengkap h-2 rounded-full transition-[width] duration-200" style="width: ${persen}%"></div>
        </div>
      </div>
    `;

  const aksi = sementara
    ? ""
    : `
      <div class="tidak-dicetak flex gap-2 flex-wrap">
        <button type="button" id="salin-daftar" class="tombol-garis flex-1 min-w-0 px-4 lg:px-5 py-3 lg:py-2.5 leading-6">
          ${ikon("copy-tinta", 18)}<span class="label-tombol">Salin daftar</span>
        </button>
        <button type="button" id="cetak-daftar" class="tombol-garis flex-1 min-w-0 px-4 lg:px-5 py-3 lg:py-2.5 leading-6">
          ${ikon("printer", 18)}<span class="label-tombol">Cetak</span>
        </button>
        <button type="button" id="wa-daftar" class="tidak-dicetak tombol-garis flex-1 min-w-0 px-4 lg:px-5 py-3 lg:py-2.5 leading-6">
          ${ikon("smartphone", 18)}<span class="label-tombol">Kirim ke WhatsApp</span>
        </button>
      </div>
      <p class="tidak-dicetak flex items-center gap-1.5 text-[13px] leading-5 text-tinta-lembut">
        ${ikon("smartphone", 14, "shrink-0 max-lg:hidden")}
        Centangan hanya tersimpan di perangkat ini.
      </p>
    `;

  return `
    <section aria-labelledby="judul-map" data-judul-kb="${escapeHTML(h.judulKb)}"
      class="map bg-white border border-garis rounded-2xl p-5 lg:p-6 flex flex-col gap-3.5 lg:gap-4
             ${sementara ? "" : "shadow-map"}">
      ${htmlJudulMap(escapeHTML(h.judulSingkat))}
      ${status}
      ${items ? `<ul>${items}</ul>` : ""}
      ${didapat}
      ${aksi}
    </section>
  `;
}

/**
 * "hari ini, 09.42" for a ticket created a moment ago.
 * @param {number} waktu — epoch ms
 * @returns {string}
 */
function formatJamMasuk(waktu) {
  const jam = new Date(waktu).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `Masuk hari ini, ${jam}`;
}

/**
 * Ticket card with the code (Web 06).
 * @param {Giliran} g
 * @param {Record<string, any>} h
 * @returns {string}
 */
function htmlPanelTiket(g, h) {
  const kode = escapeHTML(h.kode);
  return `
    <div class="bg-white border border-garis rounded-2xl overflow-hidden shadow-tiket">
      <p class="bg-tiket px-5 lg:px-6 py-3.5 flex items-center gap-2.5 text-[13px] leading-[18px] font-bold tracking-[1.04px] uppercase text-tiket-tua">
        ${ikon("ticket-amber", 20)}
        Kode tiket
      </p>
      <div class="px-5 lg:px-6 pt-6 pb-5 flex flex-col gap-4">
        <p class="font-mono font-bold text-[36px] leading-[44px] lg:text-[44px] lg:leading-[52px] break-all">${kode}</p>
        ${g.waktuSelesai ? `<p class="text-sm leading-5 text-tinta-lembut">${formatJamMasuk(g.waktuSelesai)}</p>` : ""}
        <button type="button" id="salin-kode" data-kode="${kode}"
          class="tidak-dicetak tombol-utama w-full px-5 py-3 leading-6">
          ${ikon("copy-putih", 18)}<span class="label-tombol">Salin kode</span>
        </button>
      </div>
      <!-- Perforasi -->
      <div class="relative h-0 w-full" aria-hidden="true">
        <div class="absolute inset-x-0 -top-0.5 bottom-0">
          <img src="assets/ikon/perforasi-v2.svg" width="450" height="2" alt="" class="block size-full max-w-none" />
        </div>
      </div>
      <div class="px-5 lg:px-6 pt-5 pb-6 flex flex-col gap-3">
        <p class="text-[15px] leading-6 text-tinta-isi">
          Simpan kode ini. Jawaban petugas bisa kamu lihat di halaman Cek tiket.
        </p>
        <a href="cek-tiket.html?kode=${encodeURIComponent(h.kode)}"
          class="self-start inline-flex items-center gap-1.5 text-[15px] leading-[22px] font-bold text-cap underline">
          Buka halaman Cek tiket
          ${ikon("arrow-right-aksen", 18)}
        </a>
      </div>
    </div>
  `;
}

/**
 * Pick the panel for the latest entry.
 * @param {Giliran} g
 * @returns {string}
 */
function htmlPanel(g) {
  if (g.status === "proses") return htmlPanelKerangka();
  if (g.status === "galat") return htmlPanelCakupan();

  const h = g.hasil;
  if (h.jenis === "teruskan") return htmlPanelTiket(g, h);
  if (h.jenis === "luar_cakupan") return htmlPanelCakupan();
  if (h.jenis === "paket" && !h.berkas.length && !h.didapat.length) return htmlPanelCakupan();
  if (h.berkas?.length || h.didapat?.length) return htmlPanelMap(h, { sementara: h.jenis === "tanya_balik" });
  return htmlPanelCakupan();
}

/**
 * Phone pill "Yang perlu dibawa: 2 dari 4 siap", shown while a final checklist is in the panel.
 */
function perbaruiLompatMap() {
  const map = panel.querySelector(".map");
  const progres = map?.querySelector("#progres-map");
  lompatMap.classList.toggle("hidden", !progres);
  lompatMap.classList.toggle("flex", Boolean(progres));
  if (progres) teksLompatMap.textContent = `Yang perlu dibawa: ${progres.textContent}`;
}

/* ==========================================================
   9. RENDER — single entry point for DOM updates
   ========================================================== */

/**
 * Bring the DOM in line with percakapan[]. Only entries whose version
 * changed are rewritten; the panel follows the latest entry.
 */
function render() {
  percakapan.forEach((g) => {
    let el = document.getElementById(g.id);

    if (!el) {
      el = document.createElement("div");
      el.id = g.id;
      el.className = "flex flex-col gap-5 lg:gap-6 scroll-mt-14 lg:scroll-mt-6";
      el.innerHTML = `${htmlPesanWarga(g.tampil)}<div class="isi-giliran"></div>`;
      daftarPercakapan.appendChild(el);
    }

    if (g.versiTampil !== g.versi) {
      el.querySelector(".isi-giliran").innerHTML = htmlIsi(g);
      g.versiTampil = g.versi;
      g.animasi = false; // animate a result once, not on later re-renders
    }
  });

  const terakhir = percakapan[percakapan.length - 1];
  if (terakhir) {
    const kunci = `${terakhir.id}:${terakhir.versi}`;
    if (panelTampil !== kunci) {
      panel.innerHTML = htmlPanel(terakhir);
      panelTampil = kunci;
      perbaruiLompatMap();
    }
  }

  // Composer is unavailable while an answer is being prepared
  kotakLanjutan.classList.toggle("opacity-50", sedangMemproses);
  inputLanjutan.disabled = sedangMemproses;
  formLanjutan.querySelector("button[type=submit]").disabled = sedangMemproses;

  // "Daerahmu: Kota Bandung · Ganti"
  infoWilayah.classList.toggle("hidden", !wilayah);
  namaWilayah.textContent = wilayah;
}

/* ==========================================================
   10. EVENT LISTENERS
   ========================================================== */

/* ---- Beranda: ask form ---- */

formTanya.addEventListener("submit", (e) => {
  e.preventDefault();
  const teks = inputTanya.value.trim();
  const galat = cekIsian(teks);

  if (galat) {
    tampilkanGalat(galatTanya, galat);
    inputTanya.focus();
    return;
  }

  tampilkanGalat(galatTanya, "");
  inputTanya.value = "";
  kirimPertanyaan(teks, { pertanyaan: teks });
});

// Enter sends; Shift+Enter adds a new line
inputTanya.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formTanya.requestSubmit();
  }
});

// Hide error as soon as the user starts typing
inputTanya.addEventListener("input", () => tampilkanGalat(galatTanya, ""));

/* ---- Beranda: life events ---- */

tombolPeristiwa.forEach((tombol) => {
  tombol.addEventListener("click", () => {
    const pertanyaan = tombol.dataset.pertanyaan;
    kirimPertanyaan(pertanyaan, { pertanyaan });
  });
});

/* ---- Follow-up form ---- */

formLanjutan.addEventListener("submit", (e) => {
  e.preventDefault();
  const teks = inputLanjutan.value.trim();
  const galat = cekIsian(teks);

  if (galat) {
    tampilkanGalat(galatLanjutan, galat);
    inputLanjutan.focus();
    return;
  }

  tampilkanGalat(galatLanjutan, "");
  inputLanjutan.value = "";
  kirimPertanyaan(teks, { pertanyaan: teks, layananSebelumnya: layananTerakhir() });
});

inputLanjutan.addEventListener("input", () => tampilkanGalat(galatLanjutan, ""));

// Forget the region; the next question asks for it again
gantiWilayah.addEventListener("click", () => {
  simpanWilayah("");
  render();
  inputLanjutan.focus();
});

/* ---- Conversation (event delegation) ---- */

daftarPercakapan.addEventListener("click", (e) => {
  const tombol = e.target.closest("button");
  if (!tombol) return;

  const giliran = cariGiliran(tombol.dataset.giliran ?? tombol.dataset.ulang);
  if (!giliran) return;

  // Ask-back option chosen
  if (tombol.classList.contains("tombol-pilihan")) {
    if (sedangMemproses || giliran.pilihanDipilih) return;
    const pilihan = tombol.dataset.pilihan;
    ubah(giliran, { pilihanDipilih: pilihan });

    // Region picked: ask the original question again, now for that region
    if (giliran.hasil.tanyaWilayah) {
      simpanWilayah(pilihan);
      kirimPertanyaan(pilihan, { ...giliran.permintaan, wilayah: pilihan });
      return;
    }

    kirimPertanyaan(pilihan, {
      pertanyaan: giliran.permintaan.pertanyaan,
      pertanyaanBalik: giliran.hasil.pertanyaanBalik,
      jawabanBalik: pilihan,
      layananSebelumnya: giliran.hasil.judulKb || layananTerakhir(),
    });
    return;
  }

  // Rating
  if (tombol.dataset.nilai) {
    const membantu = tombol.dataset.nilai === "ya";
    ubah(giliran, { penilaian: membantu });
    render();
    fetch("/api/penilaian", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layanan: giliran.hasil?.judulKb ?? "", membantu }),
    }).catch(() => {
      // A lost rating is not worth bothering the citizen about
    });
    return;
  }

  // Retry after an error
  if (tombol.dataset.ulang) {
    kirimPertanyaan(giliran.tampil, giliran.permintaan);
  }
});

/* ---- Panel: checklist, copy, print ---- */

panel.addEventListener("change", (e) => {
  if (!e.target.classList.contains("centang")) return;

  const map = e.target.closest(".map");
  const semua = [...map.querySelectorAll(".centang")];
  const tercentang = semua.filter((c) => c.checked).map((c) => c.value);

  simpanCentang(map.dataset.judulKb, tercentang);

  const persen = persenProgres(tercentang.length, semua.length);
  map.querySelector("#progres-map").textContent = teksProgres(tercentang.length, semua.length);
  map.querySelector("#persen-map").textContent = `${persen}%`;
  map.querySelector("#bar-map").style.width = `${persen}%`;
  perbaruiLompatMap();
});

panel.addEventListener("click", (e) => {
  const tombol = e.target.closest("button");
  if (!tombol) return;

  if (tombol.id === "salin-daftar") {
    const map = tombol.closest(".map");
    const judul = map.querySelector("#judul-map").textContent.trim();
    const baris = [...map.querySelectorAll(".centang")].map(
      (c) => `${c.checked ? "[x]" : "[ ]"} ${c.value}`
    );
    const teks = [`Yang perlu dibawa: ${judul}`, ...baris, "", "Sumber: Standar Pelayanan Disdukcapil Kota Cimahi 2024"];
    salin(teks.join("\n"), tombol);
  } else if (tombol.id === "cetak-daftar") {
    window.print();
  } else if (tombol.id === "wa-daftar") {
    const map = tombol.closest(".map");
    const judul = map.querySelector("#judul-map").textContent.trim();
    const baris = [...map.querySelectorAll(".centang")].map((c) => `- ${c.value}`);
    const teks = [`Yang perlu dibawa: ${judul}`, ...baris].join("\n");
    window.open("https://wa.me/?text=" + encodeURIComponent(teks), "_blank", "noopener");
  } else if (tombol.id === "salin-kode") {
    salin(tombol.dataset.kode, tombol);
  }
});

/* ==========================================================
   11. INITIALISE
   ========================================================== */

// The sticky phone composer only has room for a short placeholder
const layarLebar = window.matchMedia("(min-width: 1024px)");
const aturPlaceholderLanjutan = () => {
  inputLanjutan.placeholder = layarLebar.matches
    ? "Tanya lagi, misalnya: kalau beda kota bagaimana?"
    : "Tanya lagi…";
};
aturPlaceholderLanjutan();
layarLebar.addEventListener("change", aturPlaceholderLanjutan);
