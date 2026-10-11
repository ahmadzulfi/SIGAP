/**
 * scripts/ingest-kb.js — load kb/*.md into Chroma through Langflow
 *
 * Joins every knowledge base file, sends the text to the "tl-ingest" flow
 * (split per "=====", embed with watsonx, store in Chroma). Run it after
 * editing anything in kb/:
 *   npm run ingest-kb                      → collection from .env (default tanya_layanan_v10)
 *   npm run ingest-kb -- tanya_layanan_v11 → a fresh collection; then set KB_KOLEKSI in .env
 *
 * Chroma skips sections that are already stored unchanged, but edited
 * sections are added next to the old ones, so after edits ingest into a
 * NEW collection name and point KB_KOLEKSI at it.
 */

import { FLOW, koleksiKb, runFlow } from "../src/langflow.js";
import { semuaBagian, teksGabungan, WILAYAH } from "../src/kb.js";

try {
  process.loadEnvFile(".env");
} catch {
  // runFlow() explains a missing API key
}

const koleksi = process.argv[2] || koleksiKb();
const bagian = semuaBagian();

/* ---- Sanity checks before spending embedding calls ---- */

const tanpaWilayah = bagian.filter((b) => !WILAYAH.includes(b.wilayah));
if (tanpaWilayah.length) {
  console.error("Bagian tanpa 'Wilayah:' yang dikenal:", tanpaWilayah.map((b) => b.judul));
  process.exit(1);
}

const judulGanda = bagian.map((b) => b.judul).filter((j, i, semua) => semua.indexOf(j) !== i);
if (judulGanda.length) {
  console.error("Judul bagian ganda:", judulGanda);
  process.exit(1);
}

WILAYAH.forEach((w) => {
  console.log(`${w.padEnd(24)} ${bagian.filter((b) => b.wilayah === w).length} bagian`);
});
console.log(`Mengirim ${bagian.length} bagian ke koleksi "${koleksi}"…`);

/* ---- Ingest ---- */

await runFlow(
  FLOW.ingest.endpoint,
  teksGabungan(),
  { [FLOW.ingest.chromaId]: { collection_name: koleksi } },
  { outputComponent: FLOW.ingest.chromaId, timeoutMs: 600_000 }
);

console.log("Selesai.");
