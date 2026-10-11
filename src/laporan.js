/**
 * src/laporan.js — figures for the Petugas page and the report for the local government
 *
 * Everything here is derived from data the app already keeps:
 *   - kb/*.md          which services each region's official documents cover
 *   - data/tiket.json  questions the AI forwarded, with the reason (kategori)
 *   - data/penilaian.json  "Apakah informasi ini membantu?"
 *   - data/riwayat.json    one line per answer (region, service, result, AI items thrown away)
 *
 * The report answers three questions for Disdukcapil:
 *   1. Which services or situations are missing from our documents? (celah)
 *   2. Which answers do citizens find unhelpful?
 *   3. What do citizens ask most, per region?
 */

import { namaLayanan } from "./dokumen.js";
import { semuaBagian, WILAYAH } from "./kb.js";
import { semuaPenilaian, semuaRiwayat, semuaTiket } from "./penyimpanan.js";

/* ==========================================================
   1. CONSTANTS
   ========================================================== */

/**
 * The six services citizens can ask about, matched against a section's
 * "Layanan:" line, a KB title, or the router's free-text service name.
 * Order matters: KIA and KTP-el before Kartu Keluarga.
 */
const LAYANAN = [
  { kunci: "kia", nama: "Kartu Identitas Anak (KIA)", pola: /\bkia\b|identitas anak/i },
  { kunci: "ktp", nama: "KTP-el", pola: /\bktp|e-?ktp/i },
  { kunci: "kk", nama: "Kartu Keluarga", pola: /kartu keluarga|\bkk\b/i },
  { kunci: "akta", nama: "Akta Kelahiran", pola: /akta kelahiran|kelahiran/i },
  { kunci: "datang", nama: "Pindah datang", pola: /pindah datang|keterangan datang/i },
  { kunci: "keluar", nama: "Pindah keluar", pola: /pindah/i },
];

/** Why a question was forwarded, as shown to officers. */
export const KATEGORI = {
  tidak_diatur: "Layanan belum diatur di dokumen",
  keadaan_khusus: "Keadaan belum ada di dokumen",
  gagal_cek: "Jawaban AI tidak lolos cek",
  tidak_dikenali: "Layanan tidak dikenali AI",
};

/** Kategori that point to a gap in the official documents, not a mistake by the AI. */
const KATEGORI_CELAH = ["tidak_diatur", "keadaan_khusus"];

/* ==========================================================
   2. HELPERS
   ========================================================== */

/**
 * The service part of a KB title ("Kota Cimahi – Kartu Keluarga – …" → "Kartu Keluarga"),
 * or the text itself when it is not a KB title.
 * @param {string} teks
 * @returns {string}
 */
function bagianLayanan(teks) {
  const potongan = teks.split(/\s+–\s+/);
  return WILAYAH.includes(potongan[0]) ? potongan[1] ?? "" : teks;
}

/**
 * One of the six services, or null for anything else (general info, akta kematian…).
 * @param {string} teks — "Layanan:" line, KB title or free text
 * @returns {typeof LAYANAN[number] | null}
 */
export function kelompokLayanan(teks) {
  const inti = bagianLayanan(teks);
  if (/informasi umum|lokasi dan kanal/i.test(inti)) return null;
  return LAYANAN.find((l) => l.pola.test(inti)) ?? null;
}

/**
 * Kategori of a ticket; older tickets without one get it from their reason text.
 * @param {{ kategori?: string, alasan?: string }} t
 * @returns {keyof typeof KATEGORI}
 */
export function kategoriTiket(t) {
  if (t.kategori && KATEGORI[t.kategori]) return t.kategori;
  const alasan = t.alasan ?? "";
  if (/tidak ada di knowledge base/i.test(alasan)) return "tidak_diatur";
  if (/tidak lolos|tidak cocok|tidak sama/i.test(alasan)) return "gagal_cek";
  if (/router tidak menemukan/i.test(alasan)) return "tidak_dikenali";
  return "keadaan_khusus";
}

/**
 * Readable service name for a ticket or rating ("akta kematian" stays as is).
 * @param {string} layanan
 * @returns {string}
 */
function labelLayanan(layanan) {
  if (!layanan) return "Belum diketahui";
  // KB titles, with or without the region in front (older tickets)
  if (/\s–\s/.test(layanan)) return namaLayanan(layanan);
  return layanan.charAt(0).toUpperCase() + layanan.slice(1);
}

/** "YYYY-MM-DD" in the server's local time. */
function tanggalLokal(waktu) {
  return new Date(waktu).toLocaleDateString("sv-SE");
}

/**
 * Keep items newer than `hari` days (0 = everything).
 * @template {{ waktu?: string, dibuat?: string }} T
 * @param {T[]} daftar
 * @param {number} hari
 * @returns {T[]}
 */
function dalamPeriode(daftar, hari) {
  if (!hari) return daftar;
  const batas = Date.now() - hari * 24 * 60 * 60 * 1000;
  return daftar.filter((x) => new Date(x.waktu ?? x.dibuat).getTime() >= batas);
}

/**
 * Count items by key, largest first.
 * @template T
 * @param {T[]} daftar
 * @param {(x: T) => string} kunci
 * @returns {{ kunci: string, jumlah: number }[]}
 */
function hitung(daftar, kunci) {
  const peta = new Map();
  daftar.forEach((x) => {
    const k = kunci(x);
    peta.set(k, (peta.get(k) ?? 0) + 1);
  });
  return [...peta].map(([k, jumlah]) => ({ kunci: k, jumlah })).sort((a, b) => b.jumlah - a.jumlah);
}

/* ==========================================================
   3. TICKETS FOR THE PETUGAS PAGE
   ========================================================== */

/**
 * Tickets newest first, with readable service and reason.
 * @returns {Record<string, any>[]}
 */
export function daftarTiketPetugas() {
  return semuaTiket()
    .slice()
    .reverse()
    .map((t) => {
      const kategori = kategoriTiket(t);
      return {
        kode: t.kode,
        pertanyaan: t.pertanyaan,
        wilayah: t.wilayah ?? "",
        layanan: labelLayanan(t.layanan ?? ""),
        kategori,
        labelKategori: KATEGORI[kategori],
        alasan: t.alasan ?? "",
        status: t.status,
        dibuat: t.dibuat,
        jawaban: t.jawaban,
        dijawabPada: t.dijawabPada,
        draf: t.draf ?? "",
      };
    });
}

/**
 * Today's numbers for the two cards above the ticket list.
 * @returns {{ dijawabAiHariIni: number, diteruskanHariIni: number }}
 */
export function ringkasanHariIni() {
  const hariIni = tanggalLokal(Date.now());
  return {
    dijawabAiHariIni: semuaRiwayat().filter((r) => r.jenis === "jawaban" && tanggalLokal(r.waktu) === hariIni).length,
    diteruskanHariIni: semuaTiket().filter((t) => tanggalLokal(t.dibuat) === hariIni).length,
  };
}

/* ==========================================================
   4. REPORT FOR THE LOCAL GOVERNMENT
   ========================================================== */

/**
 * Which of the six services each region's documents cover, straight from kb/.
 * @returns {Record<string, Record<string, { bagian: number, adaProsedur: boolean }>>}
 *   layanan kunci → wilayah → coverage
 */
function cakupanDokumen() {
  /** @type {Record<string, Record<string, { bagian: number, adaProsedur: boolean }>>} */
  const cakupan = {};
  LAYANAN.forEach((l) => {
    cakupan[l.kunci] = {};
    WILAYAH.forEach((w) => {
      cakupan[l.kunci][w] = { bagian: 0, adaProsedur: false };
    });
  });

  semuaBagian().forEach((b) => {
    const baris = b.teks.match(/^Layanan: (.+)$/m)?.[1] ?? "";
    const l = kelompokLayanan(baris);
    if (!l || !cakupan[l.kunci][b.wilayah]) return;
    const sel = cakupan[l.kunci][b.wilayah];
    sel.bagian += 1;
    sel.adaProsedur ||= /^### Prosedur/im.test(b.teks);
  });

  return cakupan;
}

/**
 * The full report.
 * @param {{ hari?: number }} [opsi] — period in days, 0 for everything
 * @returns {Record<string, any>}
 */
export function buatLaporan({ hari = 30 } = {}) {
  const tiket = dalamPeriode(semuaTiket().map((t) => ({ ...t, waktu: t.dibuat })), hari);
  const penilaian = dalamPeriode(semuaPenilaian(), hari);
  // Ask-backs are followed by the real answer, so they would count a question twice
  const riwayat = dalamPeriode(semuaRiwayat(), hari).filter((r) => r.jenis !== "tanya_balik");

  /* ---- Summary ---- */

  const membantu = penilaian.filter((p) => p.membantu).length;
  const ringkasan = {
    pertanyaan: riwayat.length,
    dijawabAi: riwayat.filter((r) => r.jenis === "jawaban").length,
    diteruskan: tiket.length,
    luarCakupan: riwayat.filter((r) => r.jenis === "luar_cakupan").length,
    berkasDitolak: riwayat.reduce((n, r) => n + (r.berkasDitolak ?? 0), 0),
    jawabanDenganKarangan: riwayat.filter((r) => (r.berkasDitolak ?? 0) > 0).length,
    penilaian: { membantu, total: penilaian.length },
  };

  /* ---- 1. Gaps in the official documents ---- */

  const cakupan = cakupanDokumen();
  const tiketCelah = tiket.filter((t) => KATEGORI_CELAH.includes(kategoriTiket(t)));

  const matriks = LAYANAN.map((l) => ({
    layanan: l.nama,
    wilayah: WILAYAH.map((w) => ({
      wilayah: w,
      ...cakupan[l.kunci][w],
      tiket: tiketCelah.filter((t) => t.wilayah === w && kelompokLayanan(t.layanan ?? "")?.kunci === l.kunci).length,
    })),
  }));

  const kelompokCelah = new Map();
  tiketCelah.forEach((t) => {
    const kategori = kategoriTiket(t);
    const layanan = kelompokLayanan(t.layanan ?? "")?.nama ?? labelLayanan(t.layanan ?? "");
    const kunci = `${t.wilayah}|${layanan}|${kategori}`;
    if (!kelompokCelah.has(kunci)) {
      kelompokCelah.set(kunci, { wilayah: t.wilayah || "Belum diketahui", layanan, kategori, labelKategori: KATEGORI[kategori], jumlah: 0, contoh: [] });
    }
    const k = kelompokCelah.get(kunci);
    k.jumlah += 1;
    // Newest examples first, at most two, so officers see what citizens actually asked
    k.contoh.unshift(t.pertanyaan);
    k.contoh = k.contoh.slice(0, 2);
  });
  const celah = [...kelompokCelah.values()].sort((a, b) => b.jumlah - a.jumlah);

  /* ---- 2. Answers rated unhelpful ---- */

  const kelompokNilai = new Map();
  penilaian.forEach((p) => {
    const petugas = /^Jawaban petugas/.test(p.layanan);
    const kunci = petugas ? "petugas" : p.layanan;
    if (!kelompokNilai.has(kunci)) {
      kelompokNilai.set(kunci, {
        layanan: petugas ? "Jawaban petugas (Cek tiket)" : labelLayanan(p.layanan),
        wilayah: petugas ? "" : WILAYAH.find((w) => p.layanan.startsWith(w)) ?? "",
        membantu: 0,
        tidak: 0,
      });
    }
    kelompokNilai.get(kunci)[p.membantu ? "membantu" : "tidak"] += 1;
  });
  const tidakMembantu = [...kelompokNilai.values()]
    .filter((n) => n.tidak > 0)
    .sort((a, b) => b.tidak - a.tidak || b.tidak / (b.tidak + b.membantu) - a.tidak / (a.tidak + a.membantu));

  /* ---- 3. Most asked, per region ---- */

  const terbanyak = WILAYAH.map((w) => {
    const milikWilayah = riwayat.filter((r) => r.wilayah === w && r.jenis !== "luar_cakupan");
    return {
      wilayah: w,
      total: milikWilayah.length,
      layanan: hitung(milikWilayah, (r) => kelompokLayanan(r.layanan)?.nama ?? "Informasi umum & lainnya").slice(0, 5),
    };
  });

  const luarCakupan = hitung(
    riwayat.filter((r) => r.jenis === "luar_cakupan"),
    (r) => labelLayanan(r.layanan)
  ).slice(0, 5);

  return {
    periodeHari: hari,
    dibuat: new Date().toISOString(),
    ringkasan,
    matriks,
    celah,
    gagalCek: tiket.filter((t) => kategoriTiket(t) === "gagal_cek").length,
    tidakMembantu,
    terbanyak,
    luarCakupan,
  };
}
