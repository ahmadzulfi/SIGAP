/**
 * src/dokumen.js — reading and cross-checking knowledge base sections
 *
 * The AI rewrites the answer for citizens, but every requirement it lists
 * must still be traceable to the official document. This module:
 *   - splits one knowledge base section into its parts (Persyaratan, Biaya…)
 *   - checks AI text against those parts ("dicek ulang otomatis")
 *   - derives fixed facts (place, cost, duration, source) without the AI
 */

import { WILAYAH } from "./kb.js";

/* ==========================================================
   1. CONSTANTS
   ========================================================== */

/** A line counts as grounded when this share of its words is in the source. */
const GROUNDED_RATIO = 0.6;

/** Common words that say nothing about a document's content. */
const STOPWORDS = new Set([
  "yang", "dan", "atau", "dari", "untuk", "dengan", "jika", "kalau", "bila",
  "apabila", "tidak", "dapat", "bisa", "dalam", "pada", "oleh", "itu", "ini",
  "sudah", "akan", "kamu", "anda", "saya", "nya", "para", "secara", "serta",
  "juga", "agar", "supaya", "lalu", "kemudian", "setelah", "sebelum", "masing",
]);

/** Address of the main Cimahi service office, from "Lokasi Pelayanan" in the KB. */
const MPP = "Mal Pelayanan Publik Kota Cimahi, Jl. Aruman Lt. 3";

/**
 * Where each Cimahi service is handled, from "Lokasi Pelayanan" in the KB.
 * Keyed by the section's "Layanan:" line. Sections of the other regions
 * carry their own "### Tempat pelayanan" instead.
 */
const TEMPAT_CIMAHI = {
  "Kartu Keluarga": `${MPP}, atau kantor kecamatan`,
  "Kartu Tanda Penduduk Elektronik (KTP-El)": `${MPP}, atau kantor kecamatan`,
  "Kartu Identitas Anak (KIA)": `${MPP}, atau daring lewat aplikasi DILANDACITA`,
  "Penerbitan Akta Kelahiran": `${MPP}, atau daring lewat aplikasi DILANDACITA`,
  "Pindah Keluar": `${MPP}, atau daring lewat aplikasi DILANDACITA`,
  "Pindah Datang": `${MPP}, atau daring lewat aplikasi DILANDACITA`,
};

/* ==========================================================
   2. PARSING A SECTION
   ========================================================== */

/**
 * @typedef {{
 *   judul: string,
 *   wilayah: string,
 *   layanan: string,
 *   sumber: string,
 *   url: string,
 *   bagian: Record<string, string>,
 *   teks: string
 * }} Dokumen
 */

/**
 * Split one knowledge base section (markdown) into its parts.
 * @param {string} teks — raw section text (the part after FLOW.susun.pemisah)
 * @returns {Dokumen}
 */
export function parseDokumen(teks) {
  const ambil = (pola) => teks.match(pola)?.[1]?.trim() ?? "";

  /** @type {Record<string, string>} lower-cased "### heading" → body */
  const bagian = {};
  const potongan = teks.split(/^### /m).slice(1);
  potongan.forEach((isi) => {
    const [judulBagian, ...baris] = isi.split("\n");
    bagian[judulBagian.trim().toLowerCase()] = baris.join("\n").trim();
  });

  return {
    judul: ambil(/^## (.+)$/m),
    wilayah: ambil(/^Wilayah: (.+)$/m),
    layanan: ambil(/^Layanan: (.+)$/m),
    sumber: ambil(/^Sumber: (.+)$/m),
    url: ambil(/^URL: (\S+)$/m),
    bagian,
    teks,
  };
}

/* ==========================================================
   3. CROSS-CHECKING AI TEXT ("dicek ulang otomatis")
   ========================================================== */

/**
 * Lower-case, expand common abbreviations and strip punctuation so that
 * "KK" and "Kartu Keluarga" compare as the same thing.
 * @param {string} str
 * @returns {string}
 */
function normalise(str) {
  return ` ${str.toLowerCase()} `
    .replace(/ktp[\s-]*el|e-?ktp|\bktp\b/g, "ktpel")
    .replace(/\bkk\b/g, "kartu keluarga")
    .replace(/\bkia\b/g, "kartu identitas anak")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Meaningful words of a line: long enough, or containing a digit (form codes).
 * @param {string} str
 * @returns {string[]}
 */
function kataPenting(str) {
  return normalise(str)
    .split(" ")
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOPWORDS.has(w));
}

/**
 * Share of a line's meaningful words that appear in the source text.
 * Substring matching lets "lakukan" match "melakukan".
 * @param {string} baris
 * @param {string} sumber
 * @returns {number} 0..1 (1 when the line has no meaningful words)
 */
function skorKecocokan(baris, sumber) {
  const kata = kataPenting(baris);
  if (kata.length === 0) return 1;
  const sumberNormal = normalise(sumber);
  const cocok = kata.filter((w) => sumberNormal.includes(w)).length;
  return cocok / kata.length;
}

/**
 * Keep only the lines that are grounded in the source text.
 * @param {string[]} baris
 * @param {string} sumber
 * @returns {{ lolos: string[], ditolak: string[] }}
 */
export function saringTerdukung(baris, sumber) {
  const lolos = [];
  const ditolak = [];
  baris.forEach((b) => {
    (skorKecocokan(b, sumber) >= GROUNDED_RATIO ? lolos : ditolak).push(b);
  });
  return { lolos, ditolak };
}

/**
 * True when every meaningful word of a special situation (e.g. "buku nikah
 * hilang") appears somewhere in the section, i.e. the document covers it.
 * @param {string} keadaan
 * @param {string} teksDokumen
 * @returns {boolean}
 */
export function keadaanTercakup(keadaan, teksDokumen) {
  return skorKecocokan(keadaan, teksDokumen) === 1;
}

/**
 * True when every number or time in the AI text (e.g. "08.00", "2") also
 * appears in the document, so opening hours and phone numbers are not invented.
 * @param {string} teksAi
 * @param {string} teksDokumen
 * @returns {boolean}
 */
export function angkaSesuai(teksAi, teksDokumen) {
  const angka = teksAi.match(/\d[\d.:]*\d|\d/g) ?? [];
  return angka.every((a) => teksDokumen.includes(a));
}

/**
 * Rough similarity of two section titles, to confirm Chroma returned the
 * section the router asked for (the router sometimes drops a word).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function judulSama(a, b) {
  return skorKecocokan(a, b) >= 0.8 && skorKecocokan(b, a) >= 0.8;
}

/**
 * Do two requirement lines from different services name the same document?
 * Used to merge a package checklist; strict on purpose, since merging two
 * different documents would drop one from the citizen's list.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function berkasSama(a, b) {
  const kataA = new Set(kataPenting(a));
  const kataB = new Set(kataPenting(b));
  if (kataA.size === 0 || kataB.size === 0) return normalise(a).trim() === normalise(b).trim();
  const sama = [...kataA].filter((w) => kataB.has(w)).length;
  return sama / (kataA.size + kataB.size - sama) >= 0.7;
}

/* ==========================================================
   4. FACTS TAKEN DIRECTLY FROM THE DOCUMENT
   ========================================================== */

/**
 * Citizen-friendly service name from a KB title, without the AI.
 * "Kota Bandung – Kartu Keluarga – Penerbitan Kartu Keluarga baru karena … bagi Penduduk WNI"
 *   → "Kartu Keluarga baru karena …"
 * @param {string} judulKb
 * @returns {string}
 */
export function namaLayanan(judulKb) {
  const bagian = judulKb.split(/\s+–\s+/);
  if (WILAYAH.includes(bagian[0])) bagian.shift();
  const [depan, belakang] = bagian;
  let nama = !belakang || belakang === "Umum" ? depan : belakang;
  nama = nama
    .replace(/^Penerbitan\s+/i, "")
    // "… bagi Penduduk WNI" and "… bagi Penduduk WNI atau Penduduk Orang Asing …"
    .replace(/\s+bagi Penduduk WNI\b.*$/i, "")
    .trim();
  return nama.charAt(0).toUpperCase() + nama.slice(1);
}

/**
 * Place, cost and duration rows for the "Info layanan" table.
 * Rows without data in the document are left out.
 * @param {Dokumen} dok
 * @returns {{ label: string, isi: string }[]}
 */
export function infoLayanan(dok) {
  const baris = [];

  const tempat = barisPertama(dok.bagian["tempat pelayanan"])
    || (dok.wilayah === "Kota Cimahi" ? TEMPAT_CIMAHI[dok.layanan] : "");
  if (tempat) baris.push({ label: "Tempat", isi: tempat });

  const biaya = barisPertama(dok.bagian["biaya"]);
  if (biaya) {
    const gratis = /gratis|tidak ada biaya/i.test(biaya);
    baris.push({ label: "Biaya", isi: gratis ? "Gratis" : biaya });
  }

  const waktu = barisPertama(dok.bagian["jangka waktu"]);
  if (waktu) {
    // "Maksimal 2 (dua) hari kerja sejak …" → "Maksimal 2 hari kerja sejak …"
    baris.push({ label: "Lama proses", isi: waktu.replace(/\s*\([a-z ]+\)/gi, "") });
  }

  return baris;
}

/**
 * Source line shown under the answer.
 * @param {Dokumen} dok
 * @returns {{ teks: string, url: string, catatan: string }}
 */
export function sumberDokumen(dok) {
  const tahun = dok.sumber.match(/tahun (\d{4})/i)?.[1];
  const diakses = dok.sumber.match(/diakses ([^);]+)/i)?.[1];

  // Cimahi's SPP keeps its short name; other sources show their first clause
  // ("Peraturan Bupati Bandung Nomor 2 Tahun 2019 tentang …")
  const sppCimahi = dok.wilayah === "Kota Cimahi" && /Standar Pelayanan Publik/i.test(dok.sumber);
  const teks = sppCimahi
    ? `Standar Pelayanan Disdukcapil Kota Cimahi ${tahun ?? ""}`.trim()
    : dok.sumber.split(/\s+\(|;|,/)[0].trim();

  let catatan = "Dokumen sumber tidak mencantumkan tahun.";
  if (diakses) catatan = `Data situs resmi diakses ${diakses.trim()}.`;
  else if (sppCimahi && tahun) catatan = `Dokumen sumber terakhir diperbarui tahun ${tahun}.`;
  else if (tahun) catatan = `Dokumen sumber tahun ${tahun}.`;

  return { teks, url: dok.url, catatan };
}

/**
 * First non-empty line of a section body, without trailing punctuation.
 * @param {string | undefined} isi
 * @returns {string}
 */
function barisPertama(isi) {
  const baris = (isi ?? "").split("\n").find((b) => b.trim());
  return baris ? baris.trim().replace(/[.;]$/, "") : "";
}
