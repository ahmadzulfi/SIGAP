/**
 * scripts/ambil-spp-bandung.js — build the Kota Bandung SPP document from
 * standarpelayanan.bandung.go.id
 *
 * The site has no downloadable SPP PDF; it serves each service's standard
 * through a public JSON API. This script turns that data into one Markdown
 * document (sumber/spp-kota-bandung-web.md) in the same shape as the
 * knowledge base sections, so it can be split and ingested later.
 *
 * Text from the site is copied as-is (HTML → Markdown only). Staff names
 * ("pelaksana") are left out on purpose: personal data, not useful to citizens.
 *
 *   npm run ambil-spp-bandung
 */

import { mkdirSync, writeFileSync } from "node:fs";

/* ==========================================================
   1. CONFIGURATION
   ========================================================== */

const API = "https://standarpelayanan.bandung.go.id/api/public";
const UNIT_DISDUKCAPIL = 116;
const URL_HALAMAN = `https://standarpelayanan.bandung.go.id/unit/${UNIT_DISDUKCAPIL}/pelayanan`;

const FOLDER_SUMBER = new URL("../sumber/", import.meta.url);
const FILE_HASIL = new URL("spp-kota-bandung-web.md", FOLDER_SUMBER);
const FILE_MENTAH = new URL(`spbdg-${UNIT_DISDUKCAPIL}-pelayanan.json`, FOLDER_SUMBER);

/* ==========================================================
   2. HTML → MARKDOWN
   ========================================================== */

const ENTITAS = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…",
};

/**
 * Decode HTML entities (named and numeric).
 * @param {string} str
 * @returns {string}
 */
function decodeEntitas(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (asli, kode) => {
    if (kode[0] === "#") {
      const angka = kode[1].toLowerCase() === "x" ? parseInt(kode.slice(2), 16) : Number(kode.slice(1));
      return String.fromCodePoint(angka);
    }
    return ENTITAS[kode.toLowerCase()] ?? asli;
  });
}

/**
 * Convert the site's rich-text HTML into plain Markdown, keeping list numbering.
 * @param {string} html
 * @returns {string}
 */
function htmlKeMarkdown(html) {
  const teks = String(html ?? "")
    .replace(/\r/g, "")
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, isi) => {
      let nomor = 0;
      return `\n${isi.replace(/<li[^>]*>/gi, () => `\n${++nomor}. `)}\n`;
    })
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, isi) => `\n${isi.replace(/<li[^>]*>/gi, "\n- ")}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|li|h\d|table|tbody|thead)[^>]*>/gi, "\n")
    .replace(/<\/?(strong|b)>/gi, "**")
    .replace(/<[^>]+>/g, " ");

  return decodeEntitas(teks)
    .replace(/ /g, " ")
    .replace(/\*\*\s*\*\*/g, "")         // empty or back-to-back bold markers
    .split("\n")
    .map((baris) => baris.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=(\d+\.|[a-z][.)]|-)\s)/g, "\n") // list items: one per line, no gaps
    .replace(/([^\n])\n(\*\*)/g, "$1\n\n$2")         // keep a gap before bold sub-headings
    .trim();
}

/* ==========================================================
   3. API
   ========================================================== */

/**
 * GET a JSON endpoint and return its "data" field.
 * @param {string} path
 * @returns {Promise<any>}
 */
async function ambil(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { "User-Agent": "TanyaLayanan/0.1 (penyusunan knowledge base)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return (await response.json()).data;
}

/* ==========================================================
   4. BUILD THE DOCUMENT
   ========================================================== */

/**
 * One service as a knowledge-base-shaped Markdown section.
 * @param {Record<string, any>} p — one item of /units/{id}/pelayanan
 * @param {string} tanggal — retrieval date, e.g. "7 Oktober 2026"
 * @returns {string}
 */
function bagianLayanan(p, tanggal) {
  const nama = p.nama_pelayanan.trim();
  const baris = [
    `## Kota Bandung – ${nama}`,
    `Layanan: ${nama}`,
    "Wilayah: Kota Bandung",
    `Sumber: Standar Pelayanan Kota Bandung (standarpelayanan.bandung.go.id), unit Dinas Kependudukan dan Pencatatan Sipil, layanan "${nama}", diambil ${tanggal}`,
    `URL: ${URL_HALAMAN}`,
  ];

  if (p.persyaratan.length) {
    baris.push("", "### Persyaratan", ...p.persyaratan.map((s) => htmlKeMarkdown(s.syarat)));
  }

  if (p.prosedur.length) {
    baris.push("", "### Prosedur");
    p.prosedur.forEach((s) => {
      baris.push(htmlKeMarkdown(s.prosedur));
      if (s.waktu != null) baris.push(`(Waktu pelayanan: ${s.waktu} menit)`);
      baris.push("");
    });
  }

  if (p.biaya.length) {
    baris.push("", "### Biaya");
    p.biaya.forEach((b) => {
      const keterangan = htmlKeMarkdown(b.keterangan);
      baris.push(Number(b.biaya) === 0 ? "Tidak dipungut biaya/gratis." : `Rp${b.biaya}`);
      if (keterangan) baris.push(keterangan);
    });
  }

  const produk = p.produk.map((x) => htmlKeMarkdown(x.nama_produk)).filter(Boolean);
  if (produk.length) baris.push("", "### Produk layanan", ...produk);

  if (p.dasar_hukum.length) {
    baris.push("", "### Dasar hukum");
    p.dasar_hukum.forEach((d) => {
      const keterangan = htmlKeMarkdown(d.keterangan).replace(/\n+/g, " ");
      baris.push(`- ${d.nomor.trim()}${d.tahun ? ` Tahun ${d.tahun}` : ""}${keterangan ? ` — ${keterangan}` : ""}`);
    });
  }

  return baris.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ==========================================================
   5. RUN
   ========================================================== */

const tanggal = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
const { unit, pelayanan } = await ambil(`/units/${UNIT_DISDUKCAPIL}/pelayanan`);

const kepala = [
  "# Standar Pelayanan Disdukcapil Kota Bandung",
  "",
  `Disusun ulang dari ${URL_HALAMAN} pada ${tanggal}.`,
  "Situs tersebut tidak menyediakan PDF Standar Pelayanan; isi di bawah disalin apa adanya dari data",
  "situs (hanya diubah dari HTML ke Markdown). Ini bukan dokumen resmi — rujukan resminya tetap situs",
  "standarpelayanan.bandung.go.id dan Disdukcapil Kota Bandung.",
  "",
  `- Unit: ${unit.nama}`,
  `- Alamat: ${unit.alamat}`,
  `- Telepon: ${unit.telp}`,
  `- Email: ${unit.email}`,
  `- Jumlah layanan: ${pelayanan.length}`,
].join("\n");

const isi = pelayanan.map((p) => bagianLayanan(p, tanggal)).join("\n\n=====\n\n");

mkdirSync(FOLDER_SUMBER, { recursive: true });
writeFileSync(FILE_HASIL, `${kepala}\n\n=====\n\n${isi}\n`, "utf8");
// Raw copy for auditing, without staff names
const tanpaPelaksana = pelayanan.map(({ pelaksana, ...sisa }) => sisa);
writeFileSync(FILE_MENTAH, JSON.stringify({ unit, pelayanan: tanpaPelaksana }, null, 2), "utf8");

console.log(`${pelayanan.length} layanan ditulis ke sumber/spp-kota-bandung-web.md`);
