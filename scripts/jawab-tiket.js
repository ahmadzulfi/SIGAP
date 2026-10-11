/**
 * scripts/jawab-tiket.js — answer tickets from the terminal
 *
 * Stopgap until the Petugas page (Web 08) is built.
 *   npm run jawab-tiket                          → list tickets still waiting
 *   npm run jawab-tiket -- TL-7K2QXM "Jawaban…"  → answer one ticket
 */

import { readFileSync } from "node:fs";
import { jawabTiket, rapikanKode } from "../src/penyimpanan.js";

const [kodeMentah, ...kataJawaban] = process.argv.slice(2);

/* ---- No arguments: list waiting tickets ---- */

if (!kodeMentah) {
  let daftar = [];
  try {
    daftar = JSON.parse(readFileSync(new URL("../data/tiket.json", import.meta.url), "utf8"));
  } catch {
    // No tickets yet
  }

  const menunggu = daftar.filter((t) => t.status === "menunggu");
  if (menunggu.length === 0) {
    console.log("Tidak ada tiket yang menunggu jawaban.");
  } else {
    menunggu.forEach((t) => {
      console.log(`${t.kode}  ${t.dibuat.slice(0, 16).replace("T", " ")}`);
      console.log(`  Pertanyaan: ${t.pertanyaan}`);
      if (t.wilayah) console.log(`  Wilayah   : ${t.wilayah}`);
      if (t.layanan) console.log(`  Layanan   : ${t.layanan}`);
      if (t.alasan) console.log(`  Alasan    : ${t.alasan}`);
      console.log();
    });
  }
  process.exit(0);
}

/* ---- Code + answer: store the officer's answer ---- */

const jawaban = kataJawaban.join(" ").trim();
if (!jawaban) {
  console.error('Tulis jawabannya juga, misalnya: npm run jawab-tiket -- TL-7K2QXM "Urus duplikat buku nikah dulu di KUA."');
  process.exit(1);
}

const tiket = jawabTiket(rapikanKode(kodeMentah), jawaban);
if (!tiket) {
  console.error(`Tiket ${rapikanKode(kodeMentah)} tidak ditemukan.`);
  process.exit(1);
}

console.log(`Tiket ${tiket.kode} sudah dijawab.`);
