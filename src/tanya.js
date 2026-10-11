/**
 * src/tanya.js — the question-answering pipeline
 *
 * Architecture:
 *   jawabPertanyaan() is an async generator that yields progress events,
 *   so the browser can show the real stages of Web 02 (Proses):
 *     { tahap: "mencari" }                → looking for the service
 *     { tahap: "layanan", judul }         → router found it
 *     { tahap: "mengecek" }               → AI answer is being cross-checked
 *     { hasil, cekUlang? }                → final result (one of four kinds); cekUlang
 *                                           lists AI items the cross-check threw away
 *                                           (server-side only, never sent to the browser)
 *
 *   Steps behind those stages:
 *     0. region   — from the question, else the citizen's earlier choice, else ask
 *     1. router   — Langflow "tl-router" picks one title from that region's list
 *     2. cari     — Langflow "tl-cari" returns 8 Chroma candidates; keep the exact title
 *     3. susun    — Langflow "tl-susun" writes the answer from that one section
 *     4. cek      — this server checks the answer against the section
 *
 *   A life-event story ("anak saya baru lahir, apa yang perlu diurus?") first goes
 *   to Langflow "tl-rencana", which lists the services in order (akta → KK → KIA).
 *   Steps 2–4 then run for every service at once, and src/paket.js merges the
 *   checklists. One service only → the normal router path above.
 *
 *   Result kinds match the designs:
 *     "jawaban"      — Web 03, answer + checklist
 *     "tanya_balik"  — Web 04, AI asks one question first (also used to ask the region)
 *     "luar_cakupan" — Web 05, not a Disdukcapil service
 *     "teruskan"     — Web 06, forwarded to an officer with a ticket code
 *     "paket"        — several services for one life event, one merged checklist
 *
 *   Every ticket carries a kategori, so the Petugas report can tell gaps in the
 *   official documents apart from answers the AI got wrong:
 *     "tidak_diatur"   — the service is not in this region's documents at all
 *     "keadaan_khusus" — the service is, but the citizen's situation is not
 *     "gagal_cek"      — the AI answer did not survive the cross-check
 *     "tidak_dikenali" — the router could not match any service
 */

import { FLOW, koleksiKb, runFlow } from "./langflow.js";
import {
  angkaSesuai,
  infoLayanan,
  judulSama,
  keadaanTercakup,
  namaLayanan,
  parseDokumen,
  saringTerdukung,
  sumberDokumen,
} from "./dokumen.js";
import { daftarJudulPerWilayah, deteksiWilayah, judulWilayah, semuaBagian, WILAYAH } from "./kb.js";
import { ceritaPeristiwa, dalamBandungRaya, gabungBerkas, namaDokumenHasil, rapikanRencana } from "./paket.js";
import { buatTiket } from "./penyimpanan.js";

/* ==========================================================
   1. CONSTANTS
   ========================================================== */

/** Official sites for agencies outside Disdukcapil (never trust AI URLs). */
const INSTANSI_LAIN = [
  { pola: /imigrasi|paspor/i, nama: "Imigrasi", url: "https://www.imigrasi.go.id" },
  { pola: /\bsim\b|korlantas|satpas|polri|polisi/i, nama: "Korlantas Polri", url: "https://korlantas.polri.go.id" },
  { pola: /bpjs kesehatan/i, nama: "BPJS Kesehatan", url: "https://www.bpjs-kesehatan.go.id" },
  { pola: /bpjs ketenagakerjaan|bpjamsostek/i, nama: "BPJS Ketenagakerjaan", url: "https://www.bpjsketenagakerjaan.go.id" },
  { pola: /samsat|bapenda|pajak kendaraan/i, nama: "Bapenda Jawa Barat", url: "https://bapenda.jabarprov.go.id" },
  { pola: /pajak|djp/i, nama: "Direktorat Jenderal Pajak", url: "https://www.pajak.go.id" },
  { pola: /\bkua\b|kementerian agama|kemenag/i, nama: "Kementerian Agama", url: "https://kemenag.go.id" },
];

/** A 16-digit run is almost certainly a NIK; never send or store it. */
const POLA_NIK = /\b\d{16}\b/g;

/* ==========================================================
   2. INPUT HELPERS
   ========================================================== */

/**
 * @typedef {{
 *   pertanyaan: string,
 *   wilayah?: string,
 *   layananSebelumnya?: string,
 *   pertanyaanBalik?: string,
 *   jawabanBalik?: string
 * }} Permintaan
 */

/**
 * Remove anything that looks like a NIK before it leaves this server.
 * @param {string} teks
 * @returns {string}
 */
export function sembunyikanNik(teks) {
  return teks.replace(POLA_NIK, "[NIK disembunyikan]");
}

/**
 * Region to answer for: one clearly named in the question wins over the
 * citizen's earlier choice ("kalau di Cimahi gimana?").
 * @param {Permintaan} p
 * @returns {string} "" when still unknown
 */
function tentukanWilayah(p) {
  const disebut = deteksiWilayah(`${p.pertanyaan} ${p.jawabanBalik ?? ""}`);
  if (disebut) return disebut;
  return WILAYAH.includes(p.wilayah) ? p.wilayah : "";
}

/**
 * Build the Chat Input text for the router and the composer.
 * @param {Permintaan} p
 * @param {string} wilayah
 * @param {{ denganLayanan: boolean }} opsi
 * @returns {string}
 */
function susunMasukan(p, wilayah, { denganLayanan }) {
  const baris = [`PERTANYAAN WARGA: ${p.pertanyaan}`, `WILAYAH WARGA: ${wilayah}`];
  if (denganLayanan && p.layananSebelumnya) {
    baris.push(`LAYANAN SEBELUMNYA: ${p.layananSebelumnya}`);
  }
  if (p.jawabanBalik) {
    baris.push(`PERTANYAAN BALIK SEBELUMNYA: ${p.pertanyaanBalik ?? ""}`);
    baris.push(`JAWABAN WARGA ATAS PERTANYAAN BALIK: ${p.jawabanBalik}`);
  }
  return baris.join("\n");
}

/**
 * Parse the first JSON object in an LLM reply (it may add ``` fences).
 * @param {string} teks
 * @returns {Record<string, any>}
 */
function bacaJson(teks) {
  const awal = teks.indexOf("{");
  const akhir = teks.lastIndexOf("}");
  if (awal === -1 || akhir <= awal) {
    throw new Error(`Jawaban AI bukan JSON: ${teks.slice(0, 120)}`);
  }
  return JSON.parse(teks.slice(awal, akhir + 1));
}

/**
 * Keep only non-empty strings from an LLM array field.
 * @param {unknown} nilai
 * @returns {string[]}
 */
function daftarTeks(nilai) {
  return Array.isArray(nilai)
    ? nilai.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim())
    : [];
}

/**
 * Ask-back options as button labels: capitalised, at most three.
 * @param {unknown} nilai
 * @returns {string[]}
 */
function daftarPilihan(nilai) {
  return daftarTeks(nilai)
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
}

/**
 * Match the router's title to a real title of the region. The router
 * occasionally drops a word, so fall back to the closest title.
 * @param {string} judulRouter
 * @param {string} wilayah
 * @returns {string} "" when nothing in the region matches
 */
function cocokkanJudul(judulRouter, wilayah) {
  const daftar = judulWilayah(wilayah);
  if (daftar.includes(judulRouter)) return judulRouter;
  return daftar.find((j) => judulSama(j, judulRouter)) ?? "";
}

/**
 * Search query for one section: its header lines, i.e. the same text that
 * dominates the stored embedding (title, region, service, condition).
 * Also used by scripts/evaluasi.js to measure retrieval.
 * @param {string} judulKb
 * @returns {string}
 */
export function kepalaBagian(judulKb) {
  const bagian = semuaBagian().find((b) => b.judul === judulKb);
  return bagian.teks
    .split("\n")
    .slice(0, 5)
    .filter((baris) => /^(## |Wilayah:|Layanan:|Kondisi:)/.test(baris))
    .join("\n");
}

/* ==========================================================
   3. RESULT BUILDERS
   ========================================================== */

/**
 * Ask which region the citizen is registered in.
 * @returns {Record<string, any>}
 */
function hasilTanyaWilayah() {
  return {
    jenis: "tanya_balik",
    tanyaWilayah: true,
    pertanyaanBalik: "Kamu terdaftar sebagai warga daerah mana?",
    pilihan: WILAYAH,
    alasan: "Tempat dan cara mengurus berbeda di tiap daerah.",
    judulKb: "",
    judulSingkat: "",
    berkas: [],
  };
}

/**
 * @typedef {{ simpanTiket?: boolean }} OpsiJawab
 *   simpanTiket: false for test runs (scripts/evaluasi.js), so no real tickets are created
 */

/**
 * Forward the question to an officer and return a "teruskan" result.
 * @param {Permintaan} p
 * @param {OpsiJawab} opsi
 * @param {{ wilayah: string, layanan: string, alasan: string, kategori: string }} info
 *   alasan and kategori are kept for the officer, not shown to the citizen
 */
function hasilTeruskan(p, opsi, { wilayah, layanan, alasan, kategori }) {
  const pertanyaan = p.jawabanBalik
    ? `${p.pertanyaan} (keterangan: ${p.jawabanBalik})`
    : p.pertanyaan;
  const kode = opsi.simpanTiket === false
    ? "TL-UJI000"
    : buatTiket({ pertanyaan, wilayah, layanan, alasan, kategori }).kode;
  return { jenis: "teruskan", kode, wilayah, layanan, kategori };
}

/**
 * Result for services handled by another agency.
 * @param {Record<string, any>} r — router JSON
 */
function hasilLuarCakupan(r) {
  const layanan = String(r.layanan || "Layanan ini");
  const instansi = String(r.instansi || "instansi lain");
  const teksCari = `${layanan} ${instansi} ${r.instansi_induk ?? ""}`;
  const situs = INSTANSI_LAIN.find((i) => i.pola.test(teksCari));

  return {
    jenis: "luar_cakupan",
    layanan,
    instansi,
    instansiInduk: String(r.instansi_induk || ""),
    situs: situs ? { nama: situs.nama, url: situs.url } : null,
  };
}

/* ==========================================================
   4. PIPELINE
   ========================================================== */

/**
 * Answer one citizen question, yielding progress events along the way.
 * @param {Permintaan} p — pertanyaan already trimmed and NIK-masked
 * @param {OpsiJawab} [opsi]
 * @returns {AsyncGenerator<Record<string, any>>}
 */
export async function* jawabPertanyaan(p, opsi = {}) {
  /* ---- Step 0: which region's rules apply ---- */

  const wilayah = tentukanWilayah(p);
  if (!wilayah) {
    yield { hasil: hasilTanyaWilayah() };
    return;
  }

  yield { tahap: "mencari" };

  /* ---- Life event ("anak saya baru lahir"): plan a package of services ---- */

  if (ceritaPeristiwa(p.pertanyaan)) {
    const selesai = yield* jawabPeristiwa(p, wilayah, opsi);
    if (selesai) return;
  }

  /* ---- Step 1: router picks a section title of that region ---- */

  const daftarJudul = judulWilayah(wilayah).map((j) => `- ${j}`).join("\n");
  const keluaranRouter = await runFlow(
    FLOW.router.endpoint,
    susunMasukan(p, wilayah, { denganLayanan: true }),
    { [FLOW.router.promptId]: { daftar_judul: daftarJudul } }
  );
  const r = bacaJson(keluaranRouter[FLOW.router.outputId] ?? "");

  // Guard: the router sometimes calls a Disdukcapil service that is simply
  // missing from this region's KB (e.g. KIA in Bandung Barat) "out of scope"
  const instansiDukcapil = /dukcapil|kependudukan|catatan sipil/i.test(`${r.instansi ?? ""} ${r.instansi_induk ?? ""}`);
  if (r.status === "luar_cakupan" && instansiDukcapil) r.status = "tidak_tercantum";

  if (r.status === "luar_cakupan") {
    yield { hasil: hasilLuarCakupan(r) };
    return;
  }

  if (r.status === "tidak_tercantum") {
    yield {
      hasil: hasilTeruskan(p, opsi, {
        wilayah,
        layanan: String(r.layanan || ""),
        alasan: "Layanan tidak ada di knowledge base wilayah ini",
        kategori: "tidak_diatur",
      }),
    };
    return;
  }

  if (r.status === "ambigu" && !p.jawabanBalik) {
    const pilihan = daftarPilihan(r.pilihan);
    if (r.pertanyaan_balik && pilihan.length >= 2) {
      yield {
        hasil: {
          jenis: "tanya_balik",
          pertanyaanBalik: String(r.pertanyaan_balik),
          pilihan,
          alasan: "Jawabanmu menentukan layanan dan berkas yang tepat.",
          judulKb: "",
          judulSingkat: "",
          berkas: [],
          wilayah,
        },
      };
      return;
    }
  }

  // An "ambigu" after the citizen already answered falls back to the first candidate
  const judulKb = cocokkanJudul(String(r.judul || daftarTeks(r.kandidat)[0] || ""), wilayah);
  if (!judulKb) {
    yield {
      hasil: hasilTeruskan(p, opsi, {
        wilayah,
        layanan: "",
        alasan: `Router tidak menemukan layanan (${r.judul ?? r.status})`,
        kategori: "tidak_dikenali",
      }),
    };
    return;
  }

  yield { tahap: "layanan", judul: namaLayanan(judulKb) };

  /* ---- Steps 2–4: answer from that one section, then cross-check ---- */

  const { dok, a } = await ambilJawabanAi(judulKb, susunMasukan(p, wilayah, { denganLayanan: false }));
  yield { tahap: "mengecek" };
  yield cekJawaban(p, opsi, wilayah, judulKb, dok, a);
}

/**
 * Steps 2 and 3: fetch the section from Chroma, then let the AI compose from it.
 * @param {string} judulKb
 * @param {string} masukan — Chat Input text for tl-susun
 * @returns {Promise<{ dok: ReturnType<typeof parseDokumen>, a: Record<string, any> }>}
 */
async function ambilJawabanAi(judulKb, masukan) {
  /* ---- Step 2: fetch candidates from Chroma, keep the exact section ---- */

  const keluaranCari = await runFlow(FLOW.cari.endpoint, "cari", {
    [FLOW.cari.chromaId]: { search_query: kepalaBagian(judulKb), collection_name: koleksiKb() },
  });
  const kandidat = (keluaranCari[FLOW.cari.outputId] ?? "")
    .split(FLOW.cari.pemisah)
    .map((teks) => parseDokumen(teks.trim()));
  const dok = kandidat.find((d) => d.judul === judulKb);

  if (!dok) {
    // The section is in kb/ but not in Chroma: kb/ was edited without re-ingesting
    throw new Error(`Bagian "${judulKb}" tidak ada di Chroma ${koleksiKb()} — jalankan npm run ingest-kb`);
  }

  /* ---- Step 3: compose the answer from that one section ---- */

  const keluaranSusun = await runFlow(
    FLOW.susun.endpoint,
    masukan,
    { [FLOW.susun.promptId]: { context: dok.teks } }
  );
  return { dok, a: bacaJson(keluaranSusun[FLOW.susun.outputId] ?? "") };
}

/**
 * Step 4: cross-check the AI answer against the section and build the result.
 * @param {Permintaan} p
 * @param {OpsiJawab} opsi
 * @param {string} wilayah — region the answer is for
 * @param {string} judulKb
 * @param {ReturnType<typeof parseDokumen>} dok
 * @param {Record<string, any>} a — tl-susun JSON
 * @returns {{ hasil: Record<string, any>, cekUlang?: { berkasDitolak: string[], langkahDitolak: string[] } }}
 */
function cekJawaban(p, opsi, wilayah, judulKb, dok, a) {
  /** Forward with this section as the service. */
  const teruskan = (alasan, kategori) =>
    hasilTeruskan(p, opsi, { wilayah, layanan: judulKb, alasan, kategori });

  if (dok.wilayah !== wilayah) {
    return { hasil: teruskan(`Wilayah dokumen (${dok.wilayah}) tidak sama dengan wilayah warga`, "gagal_cek") };
  }

  const keadaan = String(a.keadaan_khusus ?? "").trim();
  if (a.jenis === "teruskan" || (keadaan && !keadaanTercakup(keadaan, dok.teks))) {
    const alasan = a.alasan_teruskan || `Keadaan khusus tidak tercantum: ${keadaan}`;
    return { hasil: teruskan(alasan, "keadaan_khusus") };
  }

  const persyaratan = dok.bagian["persyaratan"] ?? "";
  const prosedur = dok.bagian["prosedur"] ?? "";

  const berkas = saringTerdukung(daftarTeks(a.berkas), persyaratan);
  const langkah = prosedur
    ? saringTerdukung(daftarTeks(a.cara_mengurus), prosedur)
    : { lolos: [], ditolak: [] };

  // What the AI wrote that is not in the document; counted for the Petugas report
  const cekUlang = { berkasDitolak: berkas.ditolak, langkahDitolak: langkah.ditolak };
  if (berkas.ditolak.length) {
    console.warn(`[cek ulang] ${berkas.ditolak.length} berkas dibuang:`, berkas.ditolak);
  }

  // A section with requirements must produce at least one verified item
  if (persyaratan && berkas.lolos.length === 0) {
    return { hasil: teruskan("Daftar berkas tidak lolos pengecekan ulang", "gagal_cek"), cekUlang };
  }

  // General-info answers carry numbers (hours, phone); they must match the document
  const pembuka = String(a.pembuka ?? "").trim();
  if (!persyaratan && (!pembuka || !angkaSesuai(pembuka, dok.teks))) {
    return { hasil: teruskan("Jawaban informasi umum tidak cocok dengan dokumen", "gagal_cek"), cekUlang };
  }

  const dasar = {
    judulKb,
    wilayah,
    judulLayanan: String(a.judul_layanan || namaLayanan(judulKb)),
    judulSingkat: String(a.judul_singkat || namaLayanan(judulKb)),
    berkas: berkas.lolos,
  };

  const pilihan = daftarPilihan(a.pilihan);
  if (a.jenis === "tanya_balik" && a.pertanyaan_balik && pilihan.length >= 2 && !p.jawabanBalik) {
    return {
      hasil: {
        ...dasar,
        jenis: "tanya_balik",
        pertanyaanBalik: String(a.pertanyaan_balik),
        pilihan,
        alasan: String(a.alasan_tanya_balik || ""),
      },
      cekUlang,
    };
  }

  return {
    hasil: {
      ...dasar,
      jenis: "jawaban",
      // With a checklist the page shows fixed copy; the AI text is only used for general info
      pembuka: persyaratan ? "" : pembuka,
      caraMengurus: langkah.lolos.length >= 2 ? langkah.lolos : [],
      info: infoLayanan(dok),
      sumber: sumberDokumen(dok),
    },
    cekUlang,
  };
}

/* ==========================================================
   5. LIFE-EVENT PACKAGES
   ========================================================== */

/**
 * Chat Input for tl-susun when it composes one step of a package.
 * @param {Permintaan} p
 * @param {import("./paket.js").LangkahRencana} l
 * @param {string} peristiwa
 * @returns {string}
 */
function masukanLangkah(p, l, peristiwa) {
  const baris = [`PERTANYAAN WARGA: ${p.pertanyaan}`, `WILAYAH WARGA: ${l.wilayah}`];
  if (p.jawabanBalik) baris.push(`KETERANGAN WARGA: ${p.jawabanBalik}`);
  baris.push(
    `CATATAN: Ini satu langkah dari paket "${peristiwa}". Susun jawaban HANYA untuk layanan di KONTEKS. ` +
      "Jangan bertanya balik; tulis butir bersyarat lengkap dengan syaratnya. " +
      "Peristiwa yang diceritakan warga (kelahiran, pernikahan, pindah, kematian, perceraian) adalah alasan layanan ini diurus, " +
      'BUKAN keadaan khusus: isi "keadaan_khusus" hanya jika warga menyebut masalah lain, misalnya dokumen syarat yang hilang.'
  );
  return baris.join("\n");
}

/**
 * Plan a life event with tl-rencana, then answer every service in it.
 * Returns false when the planner finds just one service: the router answers it.
 * @param {Permintaan} p
 * @param {string} wilayah
 * @param {OpsiJawab} opsi
 * @returns {AsyncGenerator<Record<string, any>, boolean>}
 */
async function* jawabPeristiwa(p, wilayah, opsi) {
  const keluaran = await runFlow(
    FLOW.rencana.endpoint,
    susunMasukan(p, wilayah, { denganLayanan: false }),
    { [FLOW.rencana.promptId]: { daftar_judul: daftarJudulPerWilayah() } }
  );
  const r = bacaJson(keluaran[FLOW.rencana.outputId] ?? "");

  // e.g. "Pindahnya ke mana?": the answer changes which services are needed
  const pilihan = daftarPilihan(r.pilihan);
  if (r.status === "ambigu" && r.pertanyaan_balik && pilihan.length >= 2) {
    yield {
      hasil: {
        jenis: "tanya_balik",
        pertanyaanBalik: String(r.pertanyaan_balik),
        pilihan,
        alasan: "Jawabanmu menentukan layanan apa saja yang perlu diurus dan urutannya.",
        judulKb: "",
        judulSingkat: "",
        berkas: [],
        wilayah,
      },
    };
    return true;
  }

  const rencana = r.status === "paket" ? rapikanRencana(r) : [];
  if (rencana.length < 2) return false;

  const peristiwa = String(r.peristiwa || "Peristiwamu").trim();
  yield { tahap: "layanan", paket: true, judul: rencana.map((l) => l.layanan).join(" → ") };

  // Every service that is in kb/ is fetched and composed at the same time
  const jawabanAi = await Promise.all(
    rencana.map(async (l) => {
      if (!l.judulKb) return null;
      // Many parallel calls occasionally trip a transient Langflow error; retry once
      for (let coba = 1; coba <= 2; coba++) {
        try {
          return await ambilJawabanAi(l.judulKb, masukanLangkah(p, l, peristiwa));
        } catch (err) {
          console.error(`[paket] ${l.judulKb} (percobaan ${coba}):`, err.message.slice(0, 200));
        }
      }
      return { galat: true };
    })
  );

  yield { tahap: "mengecek" };

  const cekUlang = { berkasDitolak: [], langkahDitolak: [], perLangkah: [] };
  const langkah = rencana.map((l, i) => {
    const ai = jawabanAi[i];
    // Tickets name the step, so the officer knows which part of the package is unclear
    const pLangkah = { ...p, pertanyaan: `${p.pertanyaan} [paket ${peristiwa}, langkah: ${l.layanan}]` };

    if (!l.judulKb && !dalamBandungRaya(l.wilayah)) return { ...l, status: "luar", berkas: [] };
    if (ai?.galat) return { ...l, status: "galat", berkas: [] };

    const { hasil: h, cekUlang: c } = l.judulKb
      ? cekJawaban(pLangkah, opsi, l.wilayah, l.judulKb, ai.dok, ai.a)
      : {
          hasil: hasilTeruskan(pLangkah, opsi, {
            wilayah: l.wilayah,
            layanan: l.layanan,
            alasan: "Layanan dalam paket tidak ada di knowledge base wilayah ini",
            kategori: "tidak_diatur",
          }),
        };

    cekUlang.berkasDitolak.push(...(c?.berkasDitolak ?? []));
    cekUlang.langkahDitolak.push(...(c?.langkahDitolak ?? []));
    cekUlang.perLangkah.push({ wilayah: l.wilayah, layanan: l.judulKb || l.layanan, jenis: h.jenis, ...c });

    if (h.jenis === "teruskan") return { ...l, status: "teruskan", berkas: [], kode: h.kode, kategori: h.kategori };
    return {
      ...l,
      status: "siap",
      berkas: h.berkas,
      caraMengurus: h.caraMengurus ?? [],
      info: infoLayanan(ai.dok),
      sumber: sumberDokumen(ai.dok),
      // A step whose list still depends on the citizen's situation says so
      catatan: h.jenis === "tanya_balik" ? h.pertanyaanBalik : "",
    };
  });

  const gabungan = gabungBerkas(langkah);
  const peristiwaKecil = peristiwa.charAt(0).toLowerCase() + peristiwa.slice(1);

  // A checked step depends on what its document actually asks for; the
  // planner's guess is kept only for steps without a checked list
  const butuh = langkah.map((l, i) =>
    l.status === "siap"
      ? [...new Set(gabungan.didapat.filter((d) => d.untuk.includes(i + 1)).map((d) => d.dari))].sort()
      : l.butuh.map((n) => n + 1)
  );

  yield {
    hasil: {
      jenis: "paket",
      wilayah,
      peristiwa,
      judulKb: `Paket ${peristiwa} – ${wilayah}`,
      judulLayanan: `${peristiwa}: ${langkah.length} layanan yang perlu diurus`,
      judulSingkat: `Paket ${peristiwaKecil}`,
      langkah: langkah.map((l, i) => ({
        urutan: i + 1,
        layanan: l.layanan,
        judulKb: l.judulKb,
        wilayah: l.wilayah,
        alasan: l.alasan,
        butuh: butuh[i],
        menghasilkan: namaDokumenHasil(l),
        status: l.status,
        jumlahBerkas: l.berkas.length,
        caraMengurus: l.caraMengurus ?? [],
        info: l.info ?? [],
        sumber: l.sumber ?? null,
        catatan: l.catatan ?? "",
        kode: l.kode ?? "",
        kategori: l.kategori ?? "",
      })),
      ...gabungan,
    },
    cekUlang,
  };
  return true;
}
