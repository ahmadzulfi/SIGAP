/**
 * src/paket.js — service packages for life events
 *
 * Citizens often know what happened ("anak saya baru lahir"), not which
 * service they need. For such questions the planner flow (tl-rencana) lists
 * the services in order; src/tanya.js answers each one through the normal
 * cari → susun → cek path, and this module:
 *   - decides whether a question is a life-event story at all
 *   - keeps only steps whose title exists word for word in kb/
 *   - merges the per-service checklists into one list without duplicates,
 *     marking documents that an earlier step produces ("didapat dari langkah 1")
 */

import { berkasSama, namaLayanan } from "./dokumen.js";
import { semuaBagian, WILAYAH } from "./kb.js";

/* ==========================================================
   1. CONSTANTS
   ========================================================== */

/** A story about a life event: birth, marriage, moving house, death, divorce. */
const POLA_PERISTIWA = new RegExp(
  [
    // Birth: "anak saya baru lahir", "istri saya lahiran", "habis melahirkan"
    String.raw`\b(anak|bayi|putra|putri)\b[^.?!]{0,30}\blahir\b`,
    String.raw`\b(melahirkan|lahiran)\b`,
    String.raw`\bpunya (anak|bayi)\b`,
    // Marriage: "baru menikah", "habis nikah"
    String.raw`\b(baru|mau|akan|sudah|habis|abis) (menikah|nikah)\b`,
    // Moving: "pindah rumah", "mau pindah", "pindahan"
    String.raw`\bpindah (rumah|domisili|tempat tinggal|alamat)\b`,
    String.raw`\b(mau|akan|baru) pindah\b`,
    String.raw`\bpindahan\b`,
    // Death: "ayah saya meninggal", "almarhum suami saya"
    String.raw`\b(meninggal|wafat|almarhum|almarhumah|tutup usia)\b`,
    // Divorce: "baru cerai", "habis bercerai"
    String.raw`\b(ber)?cerai\b`,
  ].join("|"),
  "i"
);

/** The citizen already names one document; the normal router handles that. */
const POLA_DOKUMEN_TERTENTU =
  /\b(kk|kartu keluarga|ktp|ktp-?el|e-?ktp|kia|kartu identitas anak|akta|akte|skpwni)\b|pindah (keluar|datang)|surat (keterangan )?pindah/i;

/** …unless they explicitly ask for everything that needs doing. */
const POLA_TANYA_SEMUA =
  /apa (saja |aja )?yang (perlu|harus) (di)?urus|perlu (ngurus|mengurus|urus) apa|urus apa (saja|aja)/i;

/**
 * Conditions some regions file under another section. kb/ notes for Kota Bandung,
 * Kabupaten Bandung and Bandung Barat put "tambah anak yang baru lahir ke KK"
 * under the data-change KK, since they have no separate birth KK section.
 */
const PENGGANTI = [
  {
    dari: /– Kartu Keluarga – .*penambahan anggota keluarga/i,
    ke: "Kartu Keluarga – Penerbitan Kartu Keluarga karena perubahan data bagi Penduduk WNI",
  },
];

/** More steps than this is a planner mistake, not a real package. */
const MAKS_LANGKAH = 4;

/**
 * What each kind of service hands the citizen, so a later step's requirement
 * can point back to it. `layanan` matches a step's title, `berkas` a requirement line.
 */
const DOKUMEN_HASIL = [
  { layanan: /akta kelahiran/i, berkas: /akt[ae] kelahiran/i, nama: "Kutipan akta kelahiran" },
  { layanan: /akta kematian/i, berkas: /akt[ae] kematian/i, nama: "Kutipan akta kematian" },
  { layanan: /akta (perceraian|cerai)/i, berkas: /akt[ae] (perceraian|cerai)/i, nama: "Kutipan akta perceraian" },
  { layanan: /pindah keluar/i, berkas: /surat (keterangan )?pindah|skpwni|\bskp\b/i, nama: "Surat keterangan pindah" },
  { layanan: /kartu keluarga|\bkk\b/i, berkas: /kartu keluarga|\bkk\b/i, nama: "Kartu Keluarga baru" },
  { layanan: /ktp/i, berkas: /ktp/i, nama: "KTP-el baru" },
];

/* ==========================================================
   2. DETECTION AND PLAN CLEAN-UP
   ========================================================== */

/**
 * Should this question go to the planner first?
 * @param {string} pertanyaan
 * @returns {boolean}
 */
export function ceritaPeristiwa(pertanyaan) {
  if (!POLA_PERISTIWA.test(pertanyaan)) return false;
  return !POLA_DOKUMEN_TERTENTU.test(pertanyaan) || POLA_TANYA_SEMUA.test(pertanyaan);
}

/**
 * @typedef {{
 *   judulKb: string,   // exact kb/ title, "" when the service is not in the documents
 *   wilayah: string,   // where the step is done; may be outside Bandung Raya
 *   layanan: string,   // citizen-friendly name
 *   alasan: string,
 *   butuh: number[]    // 0-based indices of earlier steps this one depends on
 * }} LangkahRencana
 */

/**
 * The kb/ section a planner title points to. The planner often drops the
 * population tail ("… bagi Penduduk WNI"), so that one omission is accepted,
 * preferring the WNI section; any other difference is a different condition
 * (e.g. "KTP-el baru" for a data change) and is rejected.
 * @param {string} judul
 * @param {import("./kb.js").Bagian[]} semua
 * @returns {import("./kb.js").Bagian | null}
 */
function cariBagian(judul, semua) {
  if (!judul) return null;
  const persis = semua.find((b) => b.judul === judul);
  if (persis) return persis;

  const tanpaEkor = semua.filter((b) => b.judul.startsWith(`${judul} bagi `));
  if (tanpaEkor.length === 1) return tanpaEkor[0];
  const wni = tanpaEkor.filter((b) => b.judul.startsWith(`${judul} bagi Penduduk WNI`));
  const pilihan = wni.find((b) => b.judul === `${judul} bagi Penduduk WNI`) ?? (wni.length === 1 ? wni[0] : null);
  if (pilihan) return pilihan;

  const wilayah = judul.split(/\s+–\s+/)[0];
  const pengganti = PENGGANTI.find((p) => p.dari.test(judul));
  return pengganti ? semua.find((b) => b.judul === `${wilayah} – ${pengganti.ke}`) ?? null : null;
}

/**
 * Turn the planner's JSON into steps the server can trust. A title is kept
 * only when it names a real section (see cariBagian); a service the planner
 * names without a matching section stays in the plan with judulKb "".
 * @param {Record<string, any>} r — planner JSON with status "paket"
 * @returns {LangkahRencana[]}
 */
export function rapikanRencana(r) {
  const semua = semuaBagian();
  const langkah = [];

  for (const l of Array.isArray(r.langkah) ? r.langkah : []) {
    const judul = String(l?.judul ?? "").trim();
    const b = cariBagian(judul, semua);
    if (b && /– (Informasi Umum|Lokasi Pelayanan)/.test(b.judul)) continue;
    if (b && langkah.some((x) => x.judulKb === b.judul)) continue;

    const layanan = b ? namaLayanan(b.judul) : String(l?.layanan ?? "").trim();
    if (!layanan) continue;
    const alasan = String(l?.alasan ?? "").trim();

    langkah.push({
      judulKb: b?.judul ?? "",
      wilayah: b?.wilayah ?? String(l?.wilayah ?? "").trim(),
      layanan,
      alasan: alasan.charAt(0).toUpperCase() + alasan.slice(1),
      // Planner numbers steps from 1; keep only references to earlier steps
      butuh: (Array.isArray(l?.butuh) ? l.butuh : [])
        .map((n) => Number(n) - 1)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < langkah.length),
    });
    if (langkah.length === MAKS_LANGKAH) break;
  }

  return langkah;
}

/**
 * Is this place one of the regions covered by kb/?
 * @param {string} wilayah
 * @returns {boolean}
 */
export function dalamBandungRaya(wilayah) {
  return WILAYAH.includes(wilayah);
}

/* ==========================================================
   3. MERGING THE CHECKLISTS
   ========================================================== */

/**
 * The document a step hands the citizen, if it is one later steps ask for.
 * @param {{ judulKb: string, layanan: string }} langkah
 */
function dokumenHasil(langkah) {
  const teks = langkah.judulKb || langkah.layanan;
  return DOKUMEN_HASIL.find((d) => d.layanan.test(teks)) ?? null;
}

/**
 * @typedef {LangkahRencana & {
 *   status: "siap" | "teruskan" | "luar" | "galat",
 *   berkas: string[],
 *   [kunci: string]: unknown
 * }} LangkahSelesai
 */

/**
 * One checklist for the whole package.
 *   berkas        — what to prepare now, without duplicates (same order as the steps)
 *   berkasLangkah — for each berkas, the 1-based steps that need it
 *   didapat       — requirements an earlier step produces, so nothing to prepare yet
 * @param {LangkahSelesai[]} langkah
 */
export function gabungBerkas(langkah) {
  /** @type {string[]} */
  const berkas = [];
  /** @type {number[][]} */
  const berkasLangkah = [];
  /** @type {{ teks: string, dari: number, untuk: number[] }[]} */
  const didapat = [];

  langkah.forEach((l, i) => {
    for (const teks of l.berkas) {
      const dari = langkah.slice(0, i).findIndex((s) => dokumenHasil(s)?.berkas.test(teks));
      if (dari !== -1) {
        const ada = didapat.find((d) => d.dari === dari + 1 && berkasSama(d.teks, teks));
        if (ada) ada.untuk.push(i + 1);
        else didapat.push({ teks, dari: dari + 1, untuk: [i + 1] });
        continue;
      }

      const ada = berkas.findIndex((b) => berkasSama(b, teks));
      if (ada === -1) {
        berkas.push(teks);
        berkasLangkah.push([i + 1]);
      } else if (!berkasLangkah[ada].includes(i + 1)) {
        berkasLangkah[ada].push(i + 1);
      }
    }
  });

  return { berkas, berkasLangkah, didapat };
}

/**
 * Name of the document each step produces, for "Butuh hasil langkah 1 (…)".
 * @param {{ judulKb: string, layanan: string }} langkah
 * @returns {string}
 */
export function namaDokumenHasil(langkah) {
  return dokumenHasil(langkah)?.nama ?? "";
}
