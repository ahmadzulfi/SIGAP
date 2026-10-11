/**
 * scripts/evaluasi.js — measure retrieval and the full pipeline against Langflow
 *
 *   npm run evaluasi            → both parts
 *   npm run evaluasi -- cari    → only part A (56 sections, no LLM calls)
 *   npm run evaluasi -- tanya   → only part B (test questions, life-event packages included)
 *
 * A. Pencarian: for every section in kb/, search Chroma with that section's
 *    header (exactly what the server sends) and record where the right section
 *    lands. Rank 1 = what vector search alone would answer with; "in top 8" =
 *    what the server's exact-title pick can recover.
 * B. Pertanyaan uji: run evaluasi/pertanyaan-uji.json through jawabPertanyaan()
 *    without creating tickets, compare the result kind and section with the
 *    expected ones, and count the AI items the cross-check threw away.
 *
 * Results go to evaluasi/hasil-terakhir.md (for the README and pitch deck)
 * and evaluasi/hasil-terakhir.json (every answer, for checking by hand).
 */

import { readFileSync, writeFileSync } from "node:fs";

import { FLOW, koleksiKb, runFlow } from "../src/langflow.js";
import { parseDokumen } from "../src/dokumen.js";
import { semuaBagian } from "../src/kb.js";
import { jawabPertanyaan, kepalaBagian } from "../src/tanya.js";

try {
  process.loadEnvFile(".env");
} catch {
  // runFlow() explains a missing API key
}

const DIR = new URL("../evaluasi/", import.meta.url);
const bagianDipilih = process.argv[2] ?? "semua";

/* ==========================================================
   A. RETRIEVAL
   ========================================================== */

/**
 * @returns {Promise<{ total: number, peringkat1: number, dalam8: number, meleset: { judul: string, peringkat: number, teratas: string }[] }>}
 */
async function ujiPencarian() {
  const semua = semuaBagian();
  const meleset = [];
  let peringkat1 = 0;
  let dalam8 = 0;

  for (const [i, b] of semua.entries()) {
    const keluaran = await runFlow(FLOW.cari.endpoint, "cari", {
      [FLOW.cari.chromaId]: { search_query: kepalaBagian(b.judul), collection_name: koleksiKb() },
    });
    const judulKandidat = (keluaran[FLOW.cari.outputId] ?? "")
      .split(FLOW.cari.pemisah)
      .map((teks) => parseDokumen(teks.trim()).judul)
      .filter(Boolean);

    const peringkat = judulKandidat.indexOf(b.judul) + 1; // 0 = not found
    if (peringkat === 1) peringkat1 += 1;
    if (peringkat >= 1 && peringkat <= 8) dalam8 += 1;
    if (peringkat !== 1) meleset.push({ judul: b.judul, peringkat, teratas: judulKandidat[0] ?? "" });

    process.stdout.write(`\rPencarian ${i + 1}/${semua.length}`);
  }
  process.stdout.write("\n");

  return { total: semua.length, peringkat1, dalam8, meleset };
}

/* ==========================================================
   B. TEST QUESTIONS
   ========================================================== */

/**
 * Steps of a package result as one line, for the report.
 * @param {Record<string, any>} hasil
 * @returns {string}
 */
function judulLangkah(hasil) {
  return (hasil.langkah ?? []).map((l) => l.judulKb || `(${l.layanan}: tidak tercantum)`).join(" → ");
}

/**
 * Is a result what the test case expects?
 * @param {Record<string, any>} uji
 * @param {Record<string, any>} hasil
 * @returns {{ benar: boolean, alasan: string }}
 */
function nilai(uji, hasil) {
  if (!uji.jenis.includes(hasil.jenis)) {
    return { benar: false, alasan: `jenis ${hasil.jenis}, harusnya ${uji.jenis.join(" / ")}` };
  }
  // A package must list exactly these steps, in this order ("^$" = not in the documents)
  if (uji.langkah) {
    const judul = (hasil.langkah ?? []).map((l) => l.judulKb);
    const cocok = judul.length === uji.langkah.length && uji.langkah.every((pola, i) => new RegExp(pola).test(judul[i]));
    if (!cocok) return { benar: false, alasan: `langkah paket: ${judulLangkah(hasil)}` };
  }
  if (uji.judul && !new RegExp(uji.judul).test(hasil.judulKb ?? "")) {
    return { benar: false, alasan: `bagian "${hasil.judulKb || "-"}" tidak cocok` };
  }
  if (uji.kategori && hasil.kategori !== uji.kategori) {
    return { benar: false, alasan: `kategori ${hasil.kategori}, harusnya ${uji.kategori}` };
  }
  if (uji.tanyaWilayah && !hasil.tanyaWilayah) {
    return { benar: false, alasan: "tidak menanyakan daerah" };
  }
  return { benar: true, alasan: "" };
}

/**
 * @returns {Promise<Record<string, any>[]>} one row per test question
 */
async function ujiPertanyaan() {
  const daftarUji = JSON.parse(readFileSync(new URL("pertanyaan-uji.json", DIR), "utf8"));
  const baris = [];

  for (const [i, uji] of daftarUji.entries()) {
    process.stdout.write(`\rPertanyaan ${i + 1}/${daftarUji.length}`);
    const mulai = Date.now();
    let hasil = null;
    let cekUlang = { berkasDitolak: [], langkahDitolak: [] };
    let galat = "";

    try {
      for await (const peristiwa of jawabPertanyaan({ pertanyaan: uji.pertanyaan }, { simpanTiket: false })) {
        if (peristiwa.hasil) {
          hasil = peristiwa.hasil;
          cekUlang = peristiwa.cekUlang ?? cekUlang;
        }
      }
    } catch (err) {
      galat = err.message;
    }

    const penilaian = hasil ? nilai(uji, hasil) : { benar: false, alasan: `galat: ${galat}` };
    baris.push({
      no: i + 1,
      pertanyaan: uji.pertanyaan,
      harap: uji.jenis.join(" / "),
      jenis: hasil?.jenis ?? "galat",
      judulKb: hasil?.jenis === "paket" ? judulLangkah(hasil) : hasil?.judulKb ?? "",
      kategori: hasil?.kategori ?? "",
      berkasLolos: hasil?.berkas?.length ?? 0,
      berkasDitolak: cekUlang.berkasDitolak,
      langkahDitolak: cekUlang.langkahDitolak,
      detik: Math.round((Date.now() - mulai) / 100) / 10,
      ...penilaian,
    });
  }
  process.stdout.write("\n");

  return baris;
}

/* ==========================================================
   REPORT
   ========================================================== */

/** "42 dari 56 (75%)" */
function persen(n, total) {
  return `${n} dari ${total} (${total ? Math.round((n / total) * 100) : 0}%)`;
}

/** Escape a table cell. */
function sel(teks) {
  return String(teks).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * @param {Awaited<ReturnType<typeof ujiPencarian>> | null} cari
 * @param {Awaited<ReturnType<typeof ujiPertanyaan>> | null} tanya
 * @returns {string}
 */
function tulisMarkdown(cari, tanya) {
  const md = [
    "# Hasil evaluasi Tanya Layanan",
    "",
    `Dijalankan ${new Date().toLocaleString("id-ID")} dengan koleksi Chroma \`${koleksiKb()}\`.`,
    "Dibuat otomatis oleh `npm run evaluasi`; jangan diedit manual.",
    "",
  ];

  if (cari) {
    md.push(
      "## A. Pencarian bagian dokumen",
      "",
      "| Cara | Bagian yang benar |",
      "|---|---|",
      `| Pencarian vektor saja (peringkat 1 Chroma) | ${persen(cari.peringkat1, cari.total)} |`,
      `| Pilih judul persis dari 8 teratas (cara server) | ${persen(cari.dalam8, cari.total)} |`,
      ""
    );
    if (cari.meleset.length) {
      md.push("Bagian yang tidak di peringkat 1:", "", "| Bagian | Peringkat | Yang muncul di peringkat 1 |", "|---|---|---|");
      cari.meleset.forEach((m) => md.push(`| ${sel(m.judul)} | ${m.peringkat || "tidak ada di 8 teratas"} | ${sel(m.teratas)} |`));
      md.push("");
    }
  }

  if (tanya) {
    const benar = tanya.filter((b) => b.benar).length;
    const berkasDitolak = tanya.reduce((n, b) => n + b.berkasDitolak.length, 0);
    const berkasLolos = tanya.reduce((n, b) => n + b.berkasLolos, 0);
    const jawabanBerkarangan = tanya.filter((b) => b.berkasDitolak.length).length;
    const langkahDitolak = tanya.reduce((n, b) => n + b.langkahDitolak.length, 0);

    md.push(
      "## B. Pertanyaan uji",
      "",
      "| Ukuran | Hasil |",
      "|---|---|",
      `| Hasil sesuai harapan (jenis jawaban + bagian dokumen yang benar) | ${persen(benar, tanya.length)} |`,
      `| Berkas karangan AI yang dibuang pengecekan ulang | ${berkasDitolak} berkas, di ${jawabanBerkarangan} jawaban |`,
      `| Berkas yang lolos dan ditampilkan ke warga | ${berkasLolos} |`,
      `| Langkah "Cara mengurus" yang dibuang | ${langkahDitolak} |`,
      "",
      "| No | Pertanyaan | Harapan | Hasil | Berkas dibuang | Benar |",
      "|---|---|---|---|---|---|"
    );
    tanya.forEach((b) => {
      const hasil = b.jenis + (b.judulKb ? `: ${b.judulKb}` : "") + (b.kategori ? ` (${b.kategori})` : "");
      md.push(`| ${b.no} | ${sel(b.pertanyaan)} | ${b.harap} | ${sel(hasil)} | ${b.berkasDitolak.length} | ${b.benar ? "ya" : `tidak — ${sel(b.alasan)}`} |`);
    });
    md.push("");

    const contoh = tanya.flatMap((b) => b.berkasDitolak.map((x) => `- "${x}" (pertanyaan ${b.no})`));
    if (contoh.length) md.push("Berkas karangan AI yang dibuang:", "", ...contoh, "");
  }

  return md.join("\n");
}

/* ==========================================================
   RUN
   ========================================================== */

const cari = bagianDipilih === "tanya" ? null : await ujiPencarian();
const tanya = bagianDipilih === "cari" ? null : await ujiPertanyaan();

const markdown = tulisMarkdown(cari, tanya);
writeFileSync(new URL("hasil-terakhir.md", DIR), markdown, "utf8");
writeFileSync(new URL("hasil-terakhir.json", DIR), JSON.stringify({ cari, tanya }, null, 2), "utf8");

console.log(`\n${markdown}`);
console.log("Tersimpan di evaluasi/hasil-terakhir.md dan evaluasi/hasil-terakhir.json");
