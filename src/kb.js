/**
 * src/kb.js — the knowledge base files in kb/
 *
 * One Markdown file per region, sections separated by a line "=====".
 * Each section starts with "## <Wilayah> – <Layanan> – <Kondisi>" and a
 * "Wilayah:" line. The server uses this module to:
 *   - give the router only the titles of the citizen's region
 *   - join all files into one text for ingesting into Chroma
 */

import { readdirSync, readFileSync } from "node:fs";

/* ==========================================================
   1. CONSTANTS
   ========================================================== */

const KB_DIR = new URL("../kb/", import.meta.url);

/** Regions covered, in the order shown to citizens. */
export const WILAYAH = ["Kota Bandung", "Kabupaten Bandung", "Kabupaten Bandung Barat", "Kota Cimahi"];

/** Separator between sections, also used by the Langflow ingest flow. */
const PEMISAH = "\n\n=====\n\n";

/* ==========================================================
   2. LOADING
   ========================================================== */

/** @typedef {{ judul: string, wilayah: string, teks: string }} Bagian */

/** @type {Bagian[] | null} loaded once; restart the server after editing kb/ */
let cache = null;

/**
 * Read every section from kb/*.md (HTML comments are file notes, not content).
 * @returns {Bagian[]}
 */
export function semuaBagian() {
  if (cache) return cache;

  cache = readdirSync(KB_DIR)
    .filter((nama) => nama.endsWith(".md"))
    .sort()
    .flatMap((nama) =>
      readFileSync(new URL(nama, KB_DIR), "utf8")
        .replace(/<!--[\s\S]*?-->/g, "")
        .split(/^=====\s*$/m)
        .map((teks) => teks.trim())
        .filter((teks) => teks.startsWith("## "))
    )
    .map((teks) => ({
      judul: teks.match(/^## (.+)$/m)[1].trim(),
      wilayah: teks.match(/^Wilayah: (.+)$/m)?.[1].trim() ?? "",
      teks,
    }));

  return cache;
}

/**
 * Section titles of one region, for the router prompt.
 * @param {string} wilayah
 * @returns {string[]}
 */
export function judulWilayah(wilayah) {
  return semuaBagian().filter((b) => b.wilayah === wilayah).map((b) => b.judul);
}

/**
 * Service titles of every region, grouped by region, for the planner prompt.
 * General-info and location sections are left out: they are never a step.
 * @returns {string}
 */
export function daftarJudulPerWilayah() {
  return WILAYAH.map((w) => {
    const judul = judulWilayah(w).filter((j) => !/– (Informasi Umum|Lokasi Pelayanan)/.test(j));
    return `[${w}]\n${judul.map((j) => `- ${j}`).join("\n")}`;
  }).join("\n\n");
}

/**
 * All sections as one text, ready for the ingest flow.
 * @returns {string}
 */
export function teksGabungan() {
  return semuaBagian().map((b) => b.teks).join(PEMISAH);
}

/* ==========================================================
   3. REGION DETECTION
   ========================================================== */

/**
 * Words that point to exactly one region. Plain "Bandung" is ambiguous
 * (Kota, Kabupaten, or Bandung Barat), so it is not in any list.
 */
const PENANDA_WILAYAH = {
  "Kabupaten Bandung Barat": /bandung barat|\bkbb\b|lembang|padalarang|ngamprah|parongpong|cisarua|batujajar|cililin|cipatat|cipeundeuy|cikalong ?wetan|cihampelas|cipongkor|saguling|sindangkerta|gununghalu|rongga/i,
  "Kabupaten Bandung": /kab(upaten|\.)? ?bandung(?! barat)|soreang|baleendah|dayeuhkolot|bojongsoang|majalaya|banjaran|ciparay|rancaekek|cileunyi|margahayu|margaasih|katapang|pangalengan|ciwidey|cicalengka|pameungpeuk|solokanjeruk|arjasari|cimenyan|cilengkrang|cangkuang|kutawaringin|pacet|paseh|ibun|nagreg|cikancung|rancabali|pasirjambu|kertasari|cimaung/i,
  "Kota Bandung": /kota bandung|coblong|sukajadi|cicendo|antapani|arcamanik|buah ?batu|kiaracondong|bojongloa|lengkong|regol|sumur bandung|cidadap|cibeunying|bandung wetan|bandung kulon|astana ?anyar|babakan ciparay|batununggal|gedebage|mandalajati|panyileukan|rancasari|ujungberung|cinambo|andir|sukasari|cibiru|jl\.? ambon/i,
  "Kota Cimahi": /cimahi/i,
};

/**
 * The single region a question clearly names, or "" if none or several.
 * @param {string} teks
 * @returns {string}
 */
export function deteksiWilayah(teks) {
  const cocok = WILAYAH.filter((w) => PENANDA_WILAYAH[w].test(teks));
  return cocok.length === 1 ? cocok[0] : "";
}
