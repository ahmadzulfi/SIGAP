/**
 * src/penyimpanan.js — tickets, ratings and the answer log stored as JSON files
 *
 * Small and dependency-free: good enough for a pilot on one machine.
 * Files live in data/ and are git-ignored because they hold citizens' questions.
 *   tiket.json     — forwarded questions (with the question text, NIK masked)
 *   penilaian.json — "Apakah informasi ini membantu?"
 *   riwayat.json   — one line per answer: region, service, result kind and how many
 *                    AI items the cross-check threw away. No question text, so the
 *                    Petugas report can count demand without storing what citizens wrote.
 */

import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* ==========================================================
   1. FILE HELPERS
   ========================================================== */

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE_TIKET = join(DATA_DIR, "tiket.json");
const FILE_PENILAIAN = join(DATA_DIR, "penilaian.json");
const FILE_RIWAYAT = join(DATA_DIR, "riwayat.json");

/**
 * Read a JSON array from disk. Returns [] when the file does not exist yet.
 * @param {string} file
 * @returns {any[]}
 */
function bacaDaftar(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Write a JSON array atomically (temp file + rename) so a crash mid-write
 * never leaves a half-written file behind.
 * @param {string} file
 * @param {any[]} daftar
 */
function tulisDaftar(file, daftar) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(daftar, null, 2), "utf8");
  renameSync(tmp, file);
}

/* ==========================================================
   2. TICKETS
   ========================================================== */

/**
 * @typedef {{
 *   kode: string,
 *   pertanyaan: string,
 *   wilayah: string,
 *   layanan: string,
 *   alasan: string,
 *   kategori: string,
 *   status: "menunggu" | "dijawab",
 *   dibuat: string,
 *   jawaban: string | null,
 *   dijawabPada: string | null,
 *   draf?: string
 * }} Tiket
 */

/** No 0/O, 1/I/L so codes are easy to read aloud and retype. */
const ALFABET_KODE = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Generate a ticket code like "TL-7K2QXM".
 * @returns {string}
 */
function buatKode() {
  let acak = "";
  for (let i = 0; i < 6; i++) acak += ALFABET_KODE[randomInt(ALFABET_KODE.length)];
  return `TL-${acak}`;
}

/**
 * Normalise what a citizen types ("tl 7k2qxm", "7K2QXM") to "TL-7K2QXM".
 * @param {string} input
 * @returns {string}
 */
export function rapikanKode(input) {
  const inti = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^TL/, "");
  return `TL-${inti}`;
}

/**
 * Create a ticket for a question the AI should not answer by itself.
 * @param {{ pertanyaan: string, wilayah?: string, layanan?: string, alasan?: string, kategori?: string }} data
 *   kategori: why it was forwarded (see the header of src/tanya.js)
 * @returns {Tiket}
 */
export function buatTiket({ pertanyaan, wilayah = "", layanan = "", alasan = "", kategori = "" }) {
  const daftar = bacaDaftar(FILE_TIKET);

  let kode = buatKode();
  while (daftar.some((t) => t.kode === kode)) kode = buatKode();

  /** @type {Tiket} */
  const tiket = {
    kode,
    pertanyaan,
    wilayah,
    layanan,
    alasan,
    kategori,
    status: "menunggu",
    dibuat: new Date().toISOString(),
    jawaban: null,
    dijawabPada: null,
  };

  daftar.push(tiket);
  tulisDaftar(FILE_TIKET, daftar);
  return tiket;
}

/**
 * All tickets, oldest first (for the Petugas page and report).
 * @returns {Tiket[]}
 */
export function semuaTiket() {
  return bacaDaftar(FILE_TIKET);
}

/**
 * Find a ticket by code.
 * @param {string} kode — already normalised
 * @returns {Tiket | undefined}
 */
export function cariTiket(kode) {
  return bacaDaftar(FILE_TIKET).find((t) => t.kode === kode);
}

/**
 * Store an officer's answer on a ticket.
 * @param {string} kode
 * @param {string} jawaban
 * @returns {Tiket | undefined} the updated ticket, or undefined if not found
 */
export function jawabTiket(kode, jawaban) {
  const daftar = bacaDaftar(FILE_TIKET);
  const tiket = daftar.find((t) => t.kode === kode);
  if (!tiket) return undefined;

  tiket.status = "dijawab";
  tiket.jawaban = jawaban;
  tiket.dijawabPada = new Date().toISOString();
  delete tiket.draf;
  tulisDaftar(FILE_TIKET, daftar);
  return tiket;
}

/**
 * Keep an officer's unfinished answer on the ticket ("Simpan draf").
 * @param {string} kode
 * @param {string} draf
 * @returns {Tiket | undefined} the updated ticket, or undefined if not found
 */
export function simpanDraf(kode, draf) {
  const daftar = bacaDaftar(FILE_TIKET);
  const tiket = daftar.find((t) => t.kode === kode);
  if (!tiket) return undefined;

  tiket.draf = draf;
  tulisDaftar(FILE_TIKET, daftar);
  return tiket;
}

/* ==========================================================
   3. RATINGS ("Apakah informasi ini membantu?")
   ========================================================== */

/**
 * Record one rating.
 * @param {{ layanan: string, membantu: boolean }} data
 */
export function simpanPenilaian({ layanan, membantu }) {
  const daftar = bacaDaftar(FILE_PENILAIAN);
  daftar.push({ layanan, membantu, waktu: new Date().toISOString() });
  tulisDaftar(FILE_PENILAIAN, daftar);
}

/**
 * All ratings, oldest first.
 * @returns {{ layanan: string, membantu: boolean, waktu: string }[]}
 */
export function semuaPenilaian() {
  return bacaDaftar(FILE_PENILAIAN);
}

/* ==========================================================
   4. ANSWER LOG (no question text)
   ========================================================== */

/**
 * @typedef {{
 *   waktu: string,
 *   wilayah: string,
 *   jenis: string,
 *   layanan: string,
 *   berkasDitolak: number,
 *   langkahDitolak: number
 * }} Riwayat
 */

/**
 * Record one final result.
 * @param {Omit<Riwayat, "waktu">} data
 */
export function catatRiwayat(data) {
  const daftar = bacaDaftar(FILE_RIWAYAT);
  daftar.push({ waktu: new Date().toISOString(), ...data });
  tulisDaftar(FILE_RIWAYAT, daftar);
}

/**
 * The whole answer log, oldest first.
 * @returns {Riwayat[]}
 */
export function semuaRiwayat() {
  return bacaDaftar(FILE_RIWAYAT);
}
