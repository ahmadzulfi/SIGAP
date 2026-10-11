/**
 * server.js — Tanya Layanan web server
 *
 * Architecture:
 *   - Serves the static front end from public/
 *   - POST /api/tanya      streams pipeline events as NDJSON (one JSON per line)
 *   - GET  /api/tiket/:kode returns a ticket's status and officer answer
 *   - POST /api/penilaian  records "Apakah informasi ini membantu?"
 *   - /api/petugas/*       ticket list, answers, drafts, the report and the draft
 *                          revision proposals for the local governments (Web 08);
 *                          needs PETUGAS_KUNCI from .env, or a request from this machine
 *   - Holds the Langflow API key so it never reaches the browser
 *
 * No dependencies: Node's built-in http, fs and fetch only.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { jawabPertanyaan, sembunyikanNik } from "./src/tanya.js";
import {
  cariTiket,
  catatRiwayat,
  jawabTiket,
  rapikanKode,
  simpanDraf,
  simpanPenilaian,
} from "./src/penyimpanan.js";
import { buatLaporan, daftarTiketPetugas, ringkasanHariIni } from "./src/laporan.js";
import { buatUsulan } from "./src/usulan.js";

/* ==========================================================
   1. CONFIGURATION
   ========================================================== */

try {
  process.loadEnvFile(".env");
} catch {
  // No .env yet — runFlow() will explain that the API key is missing
}

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

/** Longest question we accept, in characters. */
const MAX_PERTANYAAN = 500;

/** Largest request body we read, in bytes. */
const MAX_BODY = 10_000;

/** Longest officer answer, in characters (matches the counter on the Petugas page). */
const MAX_JAWABAN_PETUGAS = 1000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/* ==========================================================
   2. RESPONSE HELPERS
   ========================================================== */

/**
 * Send a JSON response.
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function kirimJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * Read and parse a JSON request body, refusing anything too large.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Record<string, any>>}
 */
async function bacaBody(req) {
  let ukuran = 0;
  const potongan = [];
  for await (const bagian of req) {
    ukuran += bagian.length;
    if (ukuran > MAX_BODY) throw new Error("Permintaan terlalu besar");
    potongan.push(bagian);
  }
  return JSON.parse(Buffer.concat(potongan).toString("utf8") || "{}");
}

/**
 * Trim a free-text field and cap its length.
 * @param {unknown} nilai
 * @param {number} [maks]
 * @returns {string}
 */
function teks(nilai, maks = MAX_PERTANYAAN) {
  return typeof nilai === "string" ? nilai.trim().slice(0, maks) : "";
}

/* ==========================================================
   3. API ROUTES
   ========================================================== */

/**
 * POST /api/tanya — run the pipeline and stream its events.
 * Body: { pertanyaan, wilayah?, layananSebelumnya?, pertanyaanBalik?, jawabanBalik? }
 */
async function handleTanya(req, res) {
  let body;
  try {
    body = await bacaBody(req);
  } catch {
    return kirimJson(res, 400, { galat: "Permintaan tidak valid." });
  }

  const pertanyaan = sembunyikanNik(teks(body.pertanyaan));
  if (!pertanyaan) {
    return kirimJson(res, 400, { galat: "Pertanyaan masih kosong." });
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
  });

  try {
    const langkah = jawabPertanyaan({
      pertanyaan,
      wilayah: teks(body.wilayah, 40),
      layananSebelumnya: teks(body.layananSebelumnya, 300),
      pertanyaanBalik: sembunyikanNik(teks(body.pertanyaanBalik, 300)),
      jawabanBalik: sembunyikanNik(teks(body.jawabanBalik, 200)),
    });
    for await (const { cekUlang, ...peristiwa } of langkah) {
      if (peristiwa.hasil) catatHasil(peristiwa.hasil, cekUlang);
      res.write(`${JSON.stringify(peristiwa)}\n`);
    }
  } catch (err) {
    console.error("[tanya]", err);
    res.write(`${JSON.stringify({ galat: "Jawaban belum bisa disiapkan." })}\n`);
  }
  res.end();
}

/**
 * GET /api/tiket/:kode — ticket status for the Cek tiket page.
 * @param {string} kodeMentah — as typed by the citizen
 */
function handleTiket(res, kodeMentah) {
  const tiket = cariTiket(rapikanKode(decodeURIComponent(kodeMentah)));
  if (!tiket) {
    return kirimJson(res, 404, { galat: "Kode tiket tidak ditemukan." });
  }

  // Only what the citizen needs; internal notes (alasan) stay on the server
  kirimJson(res, 200, {
    kode: tiket.kode,
    status: tiket.status,
    pertanyaan: tiket.pertanyaan,
    jawaban: tiket.jawaban,
    dibuat: tiket.dibuat,
    dijawabPada: tiket.dijawabPada,
  });
}

/**
 * Log a final result for the Petugas report (no question text).
 * @param {Record<string, any>} hasil
 * @param {{ berkasDitolak: string[], langkahDitolak: string[], perLangkah?: Record<string, any>[] } | undefined} cekUlang
 *   perLangkah: one entry per service of a "paket" result
 */
function catatHasil(hasil, cekUlang) {
  try {
    // A package is logged per service, so the report counts each one like a single answer
    if (hasil.jenis === "paket") {
      for (const l of cekUlang?.perLangkah ?? []) {
        catatRiwayat({
          wilayah: l.wilayah,
          jenis: l.jenis === "tanya_balik" ? "jawaban" : l.jenis,
          layanan: l.layanan,
          berkasDitolak: l.berkasDitolak?.length ?? 0,
          langkahDitolak: l.langkahDitolak?.length ?? 0,
        });
      }
      return;
    }

    catatRiwayat({
      wilayah: hasil.wilayah ?? "",
      jenis: hasil.jenis,
      layanan: hasil.judulKb || hasil.layanan || "",
      berkasDitolak: cekUlang?.berkasDitolak.length ?? 0,
      langkahDitolak: cekUlang?.langkahDitolak.length ?? 0,
    });
  } catch (err) {
    // A lost log line must never break a citizen's answer
    console.error("[riwayat]", err);
  }
}

/**
 * POST /api/penilaian — body: { layanan, membantu }
 */
async function handlePenilaian(req, res) {
  try {
    const body = await bacaBody(req);
    if (typeof body.membantu !== "boolean") throw new Error("membantu harus boolean");
    simpanPenilaian({ layanan: teks(body.layanan, 300), membantu: body.membantu });
    kirimJson(res, 201, { ok: true });
  } catch {
    kirimJson(res, 400, { galat: "Penilaian tidak valid." });
  }
}

/* ==========================================================
   4. PETUGAS API (Web 08)
   ========================================================== */

/**
 * Officers see citizens' questions, so the Petugas API needs either the shared
 * key from .env (header X-Kunci-Petugas) or, when no key is set, a request
 * from this machine. Not a real login yet; see "Belum untuk produksi" in README.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {boolean} true when the request may continue
 */
function izinPetugas(req, res) {
  const kunci = process.env.PETUGAS_KUNCI;

  if (kunci) {
    const dikirim = Buffer.from(String(req.headers["x-kunci-petugas"] ?? ""));
    const benar = Buffer.from(kunci);
    if (dikirim.length === benar.length && timingSafeEqual(dikirim, benar)) return true;
    kirimJson(res, 401, { galat: "Kunci petugas salah.", perluKunci: true });
    return false;
  }

  const alamat = req.socket.remoteAddress ?? "";
  if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(alamat)) return true;
  kirimJson(res, 403, { galat: "Isi PETUGAS_KUNCI di .env untuk membuka halaman petugas dari komputer lain." });
  return false;
}

/** GET /api/petugas/tiket — every ticket, newest first, plus today's numbers. */
function handleDaftarTiket(res) {
  kirimJson(res, 200, { tiket: daftarTiketPetugas(), ringkasan: ringkasanHariIni() });
}

/**
 * POST /api/petugas/tiket/:kode/jawab — body: { jawaban }
 * POST /api/petugas/tiket/:kode/draf  — body: { draf }
 */
async function handleUbahTiket(req, res, kodeMentah, aksi) {
  let body;
  try {
    body = await bacaBody(req);
  } catch {
    return kirimJson(res, 400, { galat: "Permintaan tidak valid." });
  }

  const kode = rapikanKode(decodeURIComponent(kodeMentah));
  const isi = sembunyikanNik(teks(aksi === "jawab" ? body.jawaban : body.draf, MAX_JAWABAN_PETUGAS));
  if (aksi === "jawab" && !isi) return kirimJson(res, 400, { galat: "Jawaban masih kosong." });

  const tiket = aksi === "jawab" ? jawabTiket(kode, isi) : simpanDraf(kode, isi);
  if (!tiket) return kirimJson(res, 404, { galat: "Kode tiket tidak ditemukan." });
  kirimJson(res, 200, { ok: true });
}

/** GET /api/petugas/laporan?hari=30 — report for the local government (0 = all time). */
function handleLaporan(res, cari) {
  const hari = Number(cari.get("hari"));
  kirimJson(res, 200, buatLaporan({ hari: [0, 7, 30, 90].includes(hari) ? hari : 30 }));
}

/**
 * POST /api/petugas/usulan — body: { hari } — draft revision proposals for the
 * local governments. POST because it calls the LLM (tl-usulan) each time.
 */
async function handleUsulan(req, res) {
  let body;
  try {
    body = await bacaBody(req);
  } catch {
    return kirimJson(res, 400, { galat: "Permintaan tidak valid." });
  }
  const hari = Number(body.hari);
  try {
    kirimJson(res, 200, await buatUsulan({ hari: [0, 7, 30, 90].includes(hari) ? hari : 30 }));
  } catch (err) {
    console.error("[usulan]", err);
    kirimJson(res, 500, { galat: "Draf usulan belum bisa disusun." });
  }
}

/* ==========================================================
   5. STATIC FILES
   ========================================================== */

/**
 * Serve a file from public/, refusing paths that escape the folder.
 * @param {string} pathname
 */
async function handleStatis(res, pathname) {
  const relatif = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, decodeURIComponent(relatif)));

  if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const isi = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(isi);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Halaman tidak ditemukan.");
  }
}

/* ==========================================================
   6. ROUTER & START
   ========================================================== */

const server = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && pathname === "/api/tanya") return handleTanya(req, res);
  if (req.method === "POST" && pathname === "/api/penilaian") return handlePenilaian(req, res);

  const tiketMatch = pathname.match(/^\/api\/tiket\/([^/]+)$/);
  if (req.method === "GET" && tiketMatch) return handleTiket(res, tiketMatch[1]);

  if (pathname.startsWith("/api/petugas/")) {
    if (!izinPetugas(req, res)) return;
    if (req.method === "GET" && pathname === "/api/petugas/tiket") return handleDaftarTiket(res);
    if (req.method === "GET" && pathname === "/api/petugas/laporan") return handleLaporan(res, searchParams);
    if (req.method === "POST" && pathname === "/api/petugas/usulan") return handleUsulan(req, res);
    const ubahMatch = pathname.match(/^\/api\/petugas\/tiket\/([^/]+)\/(jawab|draf)$/);
    if (req.method === "POST" && ubahMatch) return handleUbahTiket(req, res, ubahMatch[1], ubahMatch[2]);
  }

  if (pathname.startsWith("/api/")) return kirimJson(res, 404, { galat: "Alamat API tidak dikenal." });
  if (req.method === "GET") return handleStatis(res, pathname);

  res.writeHead(405).end();
});

server.listen(PORT, HOST, () => {
  console.log(`Tanya Layanan berjalan di http://${HOST}:${PORT}`);
  if (!process.env.LANGFLOW_API_KEY) {
    console.warn("Peringatan: LANGFLOW_API_KEY belum diisi di .env — pertanyaan belum bisa dijawab.");
  }
});
