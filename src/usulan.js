/**
 * src/usulan.js — draft revision proposals for the local governments
 *
 * Closes the loop from citizen questions to policy: the gaps in the report
 * (src/laporan.js) become a draft "usulan revisi standar pelayanan" per region.
 *
 *   1. The server lists the findings (temuan) and every number in them, from
 *      kb/ coverage, forwarded tickets and citizen ratings.
 *   2. Langflow "tl-usulan" only writes the wording: one proposal per finding.
 *   3. Any number in the AI text that is not in the findings is rejected; that
 *      item (or the whole draft, if the AI fails) falls back to fixed wording.
 *
 * The officer reviews and edits the draft before sending it; nothing is sent
 * automatically.
 */

import { angkaSesuai, parseDokumen, sumberDokumen } from "./dokumen.js";
import { semuaBagian, WILAYAH } from "./kb.js";
import { buatLaporan } from "./laporan.js";
import { FLOW, runFlow } from "./langflow.js";

/* ==========================================================
   1. CONSTANTS
   ========================================================== */

/** Section for findings whose citizen did not name a region. */
const LINTAS_WILAYAH = "Lintas wilayah";

/** Fixed wording, used when the AI fails or writes numbers that are not in the data. */
const TEMPLAT = {
  tidak_diatur: (t) => ({
    usulan: `Menambahkan pengaturan layanan ${t.layanan} (persyaratan, prosedur, jangka waktu, dan biaya) ke dalam dokumen.`,
    alasan: "Tanpa pengaturan tertulis, warga tidak mendapat informasi resmi dan setiap pertanyaan harus dijawab manual oleh petugas.",
  }),
  kondisi_belum_diatur: (t) => ({
    usulan: `Melengkapi dokumen dengan ketentuan layanan ${t.layanan} untuk kondisi yang ditanyakan warga.`,
    alasan: "Warga dengan kondisi tersebut belum bisa mengetahui persyaratannya sebelum datang ke kantor layanan.",
  }),
  keadaan_khusus: (t) => ({
    usulan: `Menambahkan ketentuan untuk keadaan khusus pada layanan ${t.layanan}, misalnya dokumen syarat yang hilang atau berbeda data, ke dalam dokumen.`,
    alasan: "Keadaan seperti ini cukup sering ditanyakan dan saat ini hanya bisa dijawab petugas satu per satu.",
  }),
  tanpa_prosedur: (t) => ({
    usulan: `Melengkapi dokumen dengan prosedur atau alur pelayanan untuk layanan ${t.layanan}.`,
    alasan: "Dokumen sudah memuat persyaratan, tetapi warga belum mendapat gambaran langkah pengurusannya.",
  }),
  kurang_membantu: (t) => ({
    usulan: `Meninjau kembali kejelasan informasi layanan ${t.layanan} di dokumen.`,
    alasan: "Warga menilai jawaban yang disusun dari dokumen ini belum membantu.",
  }),
};

const TEMPLAT_PENGANTAR = (periode) =>
  `Dengan hormat, bersama ini kami sampaikan draf usulan perbaikan dokumen standar pelayanan administrasi kependudukan. ` +
  `Usulan disusun dari pertanyaan warga di layanan Tanya Layanan selama ${periode}, khususnya pertanyaan yang belum dapat dijawab dari dokumen resmi.`;

const TEMPLAT_PENUTUP =
  "Demikian usulan ini kami sampaikan. Besar harapan kami usulan ini dapat ditindaklanjuti agar informasi layanan bagi warga semakin lengkap.";

/* ==========================================================
   2. FINDINGS
   ========================================================== */

/**
 * The official document each region's knowledge base comes from
 * (the most common "Sumber:" of its sections).
 * @returns {Record<string, string>}
 */
function dokumenWilayah() {
  /** @type {Record<string, Record<string, number>>} */
  const hitung = {};
  semuaBagian().forEach((b) => {
    const teks = sumberDokumen(parseDokumen(b.teks)).teks;
    hitung[b.wilayah] ??= {};
    hitung[b.wilayah][teks] = (hitung[b.wilayah][teks] ?? 0) + 1;
  });
  return Object.fromEntries(
    Object.entries(hitung).map(([w, daftar]) => [w, Object.entries(daftar).sort((a, b) => b[1] - a[1])[0][0]])
  );
}

/** "30 hari terakhir" / "seluruh periode pencatatan" */
function teksPeriode(hari) {
  return hari ? `${hari} hari terakhir` : "seluruh periode pencatatan";
}

/**
 * @typedef {{
 *   id: string,
 *   jenis: keyof typeof TEMPLAT,
 *   wilayah: string,
 *   dokumen: string,
 *   layanan: string,
 *   pertanyaan: number,  // citizen questions behind the finding (0 for pure coverage gaps)
 *   fakta: string,       // the finding in one sentence, written by the server
 *   contoh: string[]     // citizen questions, as an illustration only
 * }} Temuan
 */

/**
 * Every finding of the period, most-asked first.
 * @param {number} hari
 * @returns {{ laporan: Record<string, any>, temuan: Temuan[] }}
 */
export function susunTemuan(hari) {
  const laporan = buatLaporan({ hari });
  const dokumen = dokumenWilayah();
  const periode = teksPeriode(hari);
  /** @type {Omit<Temuan, "id">[]} */
  const temuan = [];

  const dok = (w) => dokumen[w] ?? "dokumen standar pelayanan daerah";
  const sel = (layanan, wilayah) =>
    laporan.matriks.find((r) => r.layanan === layanan)?.wilayah.find((c) => c.wilayah === wilayah);

  /* ---- a. Services with no section at all in a region's documents ---- */

  laporan.matriks.forEach((r) => {
    r.wilayah.filter((c) => c.bagian === 0).forEach((c) => {
      const contoh = laporan.celah.find((g) => g.wilayah === c.wilayah && g.layanan === r.layanan && g.kategori === "tidak_diatur")?.contoh ?? [];
      temuan.push({
        jenis: "tidak_diatur",
        wilayah: c.wilayah,
        dokumen: dok(c.wilayah),
        layanan: r.layanan,
        pertanyaan: c.tiket,
        fakta: `Layanan ${r.layanan} tidak diatur di ${dok(c.wilayah)}. ` +
          (c.tiket
            ? `${c.tiket} pertanyaan warga tentang layanan ini diteruskan ke petugas dalam ${periode}.`
            : `Belum ada pertanyaan warga yang diteruskan untuk layanan ini dalam ${periode}.`),
        contoh,
      });
    });
  });

  /* ---- b. Forwarded questions the documents could not answer ---- */

  laporan.celah.forEach((g) => {
    const lintas = !WILAYAH.includes(g.wilayah);
    const wilayah = lintas ? LINTAS_WILAYAH : g.wilayah;
    // Already listed under a: the whole service is missing in that region
    if (!lintas && g.kategori === "tidak_diatur" && sel(g.layanan, g.wilayah)?.bagian === 0) return;

    // A service none of the six columns knows (e.g. akta kematian) is missing outright
    const layananDikenal = laporan.matriks.some((r) => r.layanan === g.layanan);
    const jenis = g.kategori === "keadaan_khusus" ? "keadaan_khusus"
      : layananDikenal && !lintas ? "kondisi_belum_diatur"
      : "tidak_diatur";
    const dokumenTemuan = lintas ? "dokumen standar pelayanan yang dipakai Tanya Layanan" : dok(g.wilayah);
    const fakta = {
      keadaan_khusus: `${g.jumlah} pertanyaan warga tentang ${g.layanan} menyebut keadaan khusus yang belum diatur di dokumen, dalam ${periode}.`,
      kondisi_belum_diatur: `${g.jumlah} pertanyaan warga tentang ${g.layanan} tidak dapat dijawab karena kondisinya belum diatur di dokumen, dalam ${periode}.`,
      tidak_diatur: `Layanan ${g.layanan} belum ada di ${dokumenTemuan}. ${g.jumlah} pertanyaan warga tentang layanan ini diteruskan ke petugas dalam ${periode}.`,
    }[jenis];
    temuan.push({
      jenis,
      wilayah,
      dokumen: dokumenTemuan,
      layanan: g.layanan,
      pertanyaan: g.jumlah,
      fakta,
      contoh: g.contoh,
    });
  });

  /* ---- c. Sections without a procedure, one finding per region ---- */

  WILAYAH.forEach((w) => {
    const tanpa = laporan.matriks.filter((r) => {
      const c = sel(r.layanan, w);
      return c && c.bagian > 0 && !c.adaProsedur;
    }).map((r) => r.layanan);
    if (!tanpa.length) return;
    temuan.push({
      jenis: "tanpa_prosedur",
      wilayah: w,
      dokumen: dok(w),
      layanan: tanpa.join(", "),
      pertanyaan: 0,
      fakta: `${dok(w)} memuat persyaratan, tetapi tidak memuat prosedur untuk layanan: ${tanpa.join(", ")}.`,
      contoh: [],
    });
  });

  /* ---- d. Answers citizens rated unhelpful ---- */

  laporan.tidakMembantu.filter((n) => WILAYAH.includes(n.wilayah)).forEach((n) => {
    temuan.push({
      jenis: "kurang_membantu",
      wilayah: n.wilayah,
      dokumen: dok(n.wilayah),
      layanan: n.layanan,
      pertanyaan: n.tidak,
      fakta: `${n.tidak} warga menilai jawaban tentang ${n.layanan} tidak membantu, ${n.membantu} menilai membantu, dalam ${periode}.`,
      contoh: [],
    });
  });

  temuan.sort((a, b) => b.pertanyaan - a.pertanyaan);
  return { laporan, temuan: temuan.map((t, i) => ({ id: `T${i + 1}`, ...t })) };
}

/* ==========================================================
   3. DRAFT
   ========================================================== */

/**
 * Parse the first JSON object in an LLM reply.
 * @param {string} teks
 * @returns {Record<string, any> | null}
 */
function bacaJson(teks) {
  const awal = teks.indexOf("{");
  const akhir = teks.lastIndexOf("}");
  if (awal === -1 || akhir <= awal) return null;
  try {
    return JSON.parse(teks.slice(awal, akhir + 1));
  } catch {
    return null;
  }
}

/**
 * Draft proposals for the period, grouped per region.
 * @param {{ hari?: number }} [opsi]
 * @returns {Promise<Record<string, any>>}
 */
export async function buatUsulan({ hari = 30 } = {}) {
  const { laporan, temuan } = susunTemuan(hari);
  const periode = teksPeriode(hari);

  // Everything the AI may mention; numbers it writes must come from here
  const fakta = {
    periode,
    pertanyaanWarga: laporan.ringkasan.pertanyaan,
    diteruskanKePetugas: laporan.ringkasan.diteruskan,
    temuan: temuan.map(({ id, jenis, wilayah, dokumen, layanan, fakta: f, contoh }) => ({
      id, jenis, wilayah, dokumen, layanan, fakta: f, ...(contoh.length && { contoh }),
    })),
  };
  // Numbers are checked against the data without the ids, so "T1" cannot vouch for a "1"
  const teksFakta = JSON.stringify({ ...fakta, temuan: fakta.temuan.map(({ id, ...isi }) => isi) });

  /** @type {Record<string, any> | null} */
  let ai = null;
  if (temuan.length) {
    try {
      const keluaran = await runFlow(FLOW.usulan.endpoint, JSON.stringify(fakta, null, 1));
      ai = bacaJson(keluaran[FLOW.usulan.outputId] ?? "");
    } catch (err) {
      console.error("[usulan]", err.message);
    }
  }

  const bersih = (nilai) => String(nilai ?? "").trim();
  const lolos = (teks) => teks && angkaSesuai(teks, teksFakta);
  const usulanAi = new Map((Array.isArray(ai?.usulan) ? ai.usulan : []).map((u) => [bersih(u?.id), u]));

  const butir = temuan.map((t) => {
    const u = usulanAi.get(t.id);
    // The region heading already names the document in full
    const ringkas = (teks) => bersih(teks).replaceAll(t.dokumen, "dokumen");
    const usulan = ringkas(u?.usulan);
    const alasan = ringkas(u?.alasan);
    const pakaiAi = lolos(usulan) && lolos(alasan);
    if (u && !pakaiAi) console.warn(`[usulan] ${t.id} memakai templat: angka AI tidak ada di data`);
    return {
      ...t,
      ...(pakaiAi ? { usulan, alasan } : TEMPLAT[t.jenis](t)),
      otomatis: !pakaiAi,
    };
  });

  const pengantar = bersih(ai?.pengantar);
  const penutup = bersih(ai?.penutup);

  const urutan = [...WILAYAH, LINTAS_WILAYAH];
  const wilayah = urutan
    .map((w) => ({
      wilayah: w,
      dokumen: butir.find((b) => b.wilayah === w)?.dokumen ?? "",
      usulan: butir.filter((b) => b.wilayah === w),
    }))
    .filter((w) => w.usulan.length);

  return {
    periodeHari: hari,
    periode,
    dibuat: new Date().toISOString(),
    // Disclosed on the page: which parts the AI wrote
    disusunAi: Boolean(ai) && butir.some((b) => !b.otomatis),
    pengantar: lolos(pengantar) ? pengantar : TEMPLAT_PENGANTAR(periode),
    penutup: lolos(penutup) ? penutup : TEMPLAT_PENUTUP,
    jumlahTemuan: temuan.length,
    wilayah,
  };
}
