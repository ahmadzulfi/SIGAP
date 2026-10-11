/**
 * petugas.js — Tanya Layanan, halaman Petugas (Web 08) + laporan untuk pemda
 *
 * Architecture:
 *   - Two views behind the hash: #tiket (inbox) and #laporan (report)
 *   - keadaan{} holds everything; render functions only read it
 *   - Every request goes through api(), which adds the officer key (when the
 *     server asks for one) and shows the key form on 401
 */

"use strict";

/* ==========================================================
   1. STATE
   ========================================================== */

/** sessionStorage key for the officer key, so it is gone when the tab closes. */
const KUNCI_SESI = "tanyalayanan_kunci_petugas";

/** Longest answer, mirrors MAX_JAWABAN_PETUGAS on the server. */
const MAX_JAWABAN = 1000;

const keadaan = {
  /** @type {Record<string, any>[]} */
  tiket: [],
  ringkasan: { dijawabAiHariIni: 0, diteruskanHariIni: 0 },
  saring: "menunggu",
  cari: "",
  /** @type {string | null} */
  dipilih: null,
  /** @type {Record<string, any> | null} */
  laporan: null,
  periode: 30,
  /** @type {Record<string, any> | null} draft proposals, for the period shown */
  usulan: null,
  /** "" | "menyusun" | an error message */
  statusUsulan: "",
};

/* ==========================================================
   2. DOM REFERENCES
   ========================================================== */

const tampilanKunci   = document.getElementById("tampilan-kunci");
const tampilanTiket   = document.getElementById("tampilan-tiket");
const tampilanLaporan = document.getElementById("tampilan-laporan");
const tautanTampilan  = document.querySelectorAll(".tautan-tampilan");

const formKunci   = document.getElementById("form-kunci");
const inputKunci  = document.getElementById("input-kunci");
const galatKunci  = document.getElementById("galat-kunci");

const kpiDijawabAi   = document.getElementById("kpi-dijawab-ai");
const kpiDiteruskan  = document.getElementById("kpi-diteruskan");
const tombolSaring   = document.querySelectorAll(".tombol-saring");
const jumlahMenunggu = document.getElementById("jumlah-menunggu");
const jumlahDijawab  = document.getElementById("jumlah-dijawab");
const cariTiket      = document.getElementById("cari-tiket");
const daftarTiket    = document.getElementById("daftar-tiket");
const detailTiket    = document.getElementById("detail-tiket");

const periodeLaporan = document.getElementById("periode-laporan");
const isiLaporan     = document.getElementById("isi-laporan");

/* ==========================================================
   3. HELPERS
   ========================================================== */

/**
 * Sanitise a string to prevent XSS when inserted into the DOM.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML.replace(/"/g, "&quot;");
}

/** Lucide icon from assets/ikon at its native size. */
function ikon(nama, ukuran, kelas = "shrink-0") {
  return `<img src="assets/ikon/${nama}.svg" width="${ukuran}" height="${ukuran}" alt="" class="${kelas}" />`;
}

/** "YYYY-MM-DD" in local time. */
function tanggal(waktu) {
  return new Date(waktu).toLocaleDateString("sv-SE");
}

/** "09.42" */
function jam(waktu) {
  return new Date(waktu).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Short time for the ticket list: "09.42" today, "Kemarin", else "6 Okt".
 * @param {string} waktu
 * @returns {string}
 */
function waktuSingkat(waktu) {
  const kemarin = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (tanggal(waktu) === tanggal(Date.now())) return jam(waktu);
  if (tanggal(waktu) === tanggal(kemarin)) return "Kemarin";
  return new Date(waktu).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

/**
 * "hari ini, 09.42", "kemarin, 18.03" or "6 Okt 2026, 23.26".
 * @param {string} waktu
 * @returns {string}
 */
function waktuLengkap(waktu) {
  const singkat = waktuSingkat(waktu);
  if (/^\d/.test(singkat) && singkat.includes(".")) return `hari ini, ${singkat}`;
  if (singkat === "Kemarin") return `kemarin, ${jam(waktu)}`;
  const tgl = new Date(waktu).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return `${tgl}, ${jam(waktu)}`;
}

/** Badge for why a ticket was forwarded: a gap in the documents, or an AI answer that failed the check. */
function htmlBadgeKategori(t) {
  const celah = t.kategori === "tidak_diatur" || t.kategori === "keadaan_khusus";
  return celah
    ? `<span class="inline-flex items-center gap-1.5 bg-abu text-tinta-isi rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold">
         ${ikon("file-14", 14)}${escapeHTML(t.labelKategori)}
       </span>`
    : `<span class="inline-flex items-center gap-1.5 bg-tiket text-tiket-tua rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold">
         ${ikon("alert-amber", 14)}${escapeHTML(t.labelKategori)}
       </span>`;
}

/** Badge for a ticket's status. */
function htmlBadgeStatus(status) {
  return status === "dijawab"
    ? `<span class="inline-flex items-center gap-1.5 bg-lengkap-muda text-lengkap-tua rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold">
         ${ikon("check-hijau", 14)} Sudah dijawab
       </span>`
    : `<span class="inline-flex items-center gap-1.5 bg-tiket text-tiket-tua rounded-full pl-2.5 pr-3 py-1 text-[13px] leading-[18px] font-semibold">
         ${ikon("clock-amber-14", 14)} Belum dijawab
       </span>`;
}

/* ==========================================================
   4. API
   ========================================================== */

/**
 * Call the Petugas API. On 401 the key form is shown and the promise rejects.
 * @param {string} alamat
 * @param {RequestInit} [opsi]
 * @returns {Promise<any>}
 */
async function api(alamat, opsi = {}) {
  let kunci = "";
  try {
    kunci = sessionStorage.getItem(KUNCI_SESI) ?? "";
  } catch {
    // Storage blocked — the officer types the key again after a reload
  }

  const response = await fetch(alamat, {
    ...opsi,
    headers: {
      "Content-Type": "application/json",
      ...(kunci && { "X-Kunci-Petugas": kunci }),
      ...opsi.headers,
    },
  });
  const body = await response.json().catch(() => ({}));

  if (response.status === 401 && body.perluKunci) {
    tampilkanFormKunci(kunci ? "Kunci petugas salah." : "");
    throw new Error("perlu kunci");
  }
  if (!response.ok) throw new Error(body.galat ?? `HTTP ${response.status}`);
  return body;
}

/** Load tickets and today's numbers. */
async function muatTiket() {
  const data = await api("/api/petugas/tiket");
  keadaan.tiket = data.tiket;
  keadaan.ringkasan = data.ringkasan;
}

/** Load the report for the chosen period. */
async function muatLaporan() {
  isiLaporan.innerHTML = `<p class="text-tinta-lembut">Menyusun laporan…</p>`;
  keadaan.laporan = await api(`/api/petugas/laporan?hari=${keadaan.periode}`);
}

/* ==========================================================
   5. RENDER — tickets (Web 08)
   ========================================================== */

/** Tickets matching the status tab and search box. */
function tiketTersaring() {
  const cari = keadaan.cari.trim().toLowerCase();
  return keadaan.tiket.filter((t) =>
    t.status === keadaan.saring &&
    (!cari || t.kode.toLowerCase().includes(cari) || t.pertanyaan.toLowerCase().includes(cari))
  );
}

/** Left column: numbers, tabs and the list. */
function renderDaftar() {
  kpiDijawabAi.textContent = keadaan.ringkasan.dijawabAiHariIni;
  kpiDiteruskan.textContent = keadaan.ringkasan.diteruskanHariIni;
  jumlahMenunggu.textContent = keadaan.tiket.filter((t) => t.status === "menunggu").length;
  jumlahDijawab.textContent = keadaan.tiket.filter((t) => t.status === "dijawab").length;
  tombolSaring.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.status === keadaan.saring)));

  const daftar = tiketTersaring();
  if (!daftar.length) {
    daftarTiket.innerHTML = `
      <li class="bg-white border border-garis rounded-xl px-4 py-6 text-center text-[15px] leading-6 text-tinta-lembut">
        ${keadaan.cari ? "Tidak ada tiket yang cocok." : keadaan.saring === "menunggu" ? "Semua tiket sudah dijawab." : "Belum ada tiket yang dijawab."}
      </li>
    `;
    return;
  }

  daftarTiket.innerHTML = daftar.map((t) => {
    const dipilih = t.kode === keadaan.dipilih;
    return `
      <li>
        <button type="button" data-kode="${escapeHTML(t.kode)}" aria-current="${dipilih}"
          class="w-full text-left rounded-xl px-4 py-3.5 flex flex-col gap-2 transition-colors
                 ${dipilih ? "bg-cap-muda border-2 border-cap" : "bg-white border border-garis hover:border-garis-tegas"}">
          <span class="w-full flex items-center justify-between gap-3">
            <span class="font-mono font-bold text-[15px] leading-[22px] ${dipilih ? "text-cap-tua" : ""}">${escapeHTML(t.kode)}</span>
            <span class="flex items-center gap-1 text-[13px] leading-[18px] text-tinta-lembut">${ikon("clock-13", 14)}${escapeHTML(waktuSingkat(t.dibuat))}</span>
          </span>
          <span class="text-[15px] leading-[22px]">${escapeHTML(t.pertanyaan)}</span>
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            ${htmlBadgeKategori(t)}
            ${t.wilayah ? `<span class="text-[13px] leading-[18px] text-tinta-lembut">${escapeHTML(t.wilayah)}</span>` : ""}
          </span>
        </button>
      </li>
    `;
  }).join("");
}

/** Right column: the chosen ticket and the answer form. */
function renderDetail() {
  const t = keadaan.tiket.find((x) => x.kode === keadaan.dipilih);
  if (!t) {
    detailTiket.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-center">
        <span class="bg-abu rounded-xl size-12 flex items-center justify-center">${ikon("inbox", 22)}</span>
        <p class="text-[15px] leading-6 text-tinta-lembut">Pilih tiket di daftar untuk membaca dan menjawabnya.</p>
      </div>
    `;
    return;
  }

  const rincian = [
    t.wilayah && `Wilayah: ${t.wilayah}`,
    t.layanan && t.layanan !== "Belum diketahui" && `Layanan: ${t.layanan}`,
  ].filter(Boolean).join(" · ");

  const jawaban = t.status === "dijawab"
    ? `
      <div class="bg-cap-muda/60 border-l-4 border-cap rounded-xl px-5 py-[18px] flex flex-col gap-2.5">
        <p class="text-[15px] leading-[22px] font-bold text-cap-tua">Jawaban yang dikirim ke warga</p>
        <p class="text-[17px] leading-7">${escapeHTML(t.jawaban)}</p>
        <p class="text-[13px] leading-[18px] text-tinta-lembut">Dijawab ${escapeHTML(waktuLengkap(t.dijawabPada))}</p>
      </div>
    `
    : `
      <form id="form-jawaban" data-kode="${escapeHTML(t.kode)}" class="flex flex-col gap-2" novalidate>
        <label for="input-jawaban" class="font-bold">Jawaban untuk warga</label>
        <div class="kotak-isian bg-white border-2 border-garis-tegas rounded-[10px] px-4 py-3.5 flex">
          <textarea id="input-jawaban" rows="6" maxlength="${MAX_JAWABAN}"
            aria-describedby="petunjuk-jawaban hitung-jawaban"
            placeholder="Tulis jawaban yang jelas dan bisa langsung dipakai warga."
            class="w-full resize-y bg-transparent leading-[26px] placeholder:text-tinta-samar">${escapeHTML(t.draf)}</textarea>
        </div>
        <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-[13px] leading-5 text-tinta-lembut">
          <p id="petunjuk-jawaban" class="flex items-center gap-1.5">
            ${ikon("lock-14", 14)}
            Warga melihat jawaban ini lewat kode tiket. Jangan tulis data pribadi warga.
          </p>
          <p id="hitung-jawaban" aria-live="polite">${t.draf.length} / ${MAX_JAWABAN}</p>
        </div>
        <p id="pesan-jawaban" class="hidden text-sm font-semibold" role="status"></p>
        <div class="flex flex-wrap gap-3 pt-4">
          <button type="submit" class="tombol-utama px-6 py-3.5 leading-6">
            Kirim jawaban ${ikon("send", 18)}
          </button>
          <button type="button" id="simpan-draf" class="tombol-garis px-5 py-3.5 leading-6">Simpan draf</button>
        </div>
      </form>
    `;

  detailTiket.innerHTML = `
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="font-mono font-bold text-[26px] leading-[34px] lg:text-[30px] lg:leading-[38px]">${escapeHTML(t.kode)}</h2>
      ${htmlBadgeStatus(t.status)}
    </div>
    <p class="-mt-2 flex items-center gap-1.5 text-[15px] leading-[22px] text-tinta-lembut">
      ${ikon("clock-16", 16)} Masuk ${escapeHTML(waktuLengkap(t.dibuat))}
    </p>
    <div class="bg-abu rounded-[10px] px-4 py-3.5 flex gap-3 items-start text-tinta-isi">
      ${ikon("file-20", 20)}
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <p class="text-sm leading-5 font-bold">Alasan diteruskan</p>
        <p class="text-[15px] leading-[22px]">${escapeHTML(t.labelKategori)}.</p>
        ${rincian ? `<p class="text-[13px] leading-5 text-tinta-lembut">${escapeHTML(rincian)}</p>` : ""}
        ${t.alasan ? `<p class="text-[13px] leading-5 text-tinta-lembut">Catatan sistem: ${escapeHTML(t.alasan)}</p>` : ""}
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <p class="text-sm leading-5 font-semibold text-tinta-lembut">Pertanyaan warga</p>
      <p class="font-judul font-semibold text-xl leading-7 lg:text-[22px] lg:leading-[30px]">${escapeHTML(t.pertanyaan)}</p>
    </div>
    ${jawaban}
  `;
}

/** Show a message under the answer form. */
function pesanJawaban(teks, galat = false) {
  const el = document.getElementById("pesan-jawaban");
  if (!el) return;
  el.textContent = teks;
  el.className = `text-sm font-semibold ${galat ? "text-galat" : "text-lengkap"}`;
}

/* ==========================================================
   6. RENDER — report for the local government
   ========================================================== */

/** One stat tile. */
function htmlKpi({ ikonNama, ukuranIkon, latar, angka, label, sub = "" }) {
  return `
    <div class="bg-white border border-garis rounded-xl p-4 lg:p-5 flex items-start gap-3">
      <span class="shrink-0 ${latar} rounded-[10px] size-11 flex items-center justify-center">${ikon(ikonNama, ukuranIkon)}</span>
      <span class="min-w-0 flex flex-col">
        <span class="font-judul font-bold text-[28px] leading-[34px]">${angka}</span>
        <span class="text-sm leading-5 text-tinta-isi">${label}</span>
        ${sub ? `<span class="text-[13px] leading-5 text-tinta-lembut">${sub}</span>` : ""}
      </span>
    </div>
  `;
}

/** White card with a heading. */
function htmlKartu(judul, keterangan, isi) {
  return `
    <section class="bg-white border border-garis rounded-2xl p-5 lg:p-7 flex flex-col gap-5 break-inside-avoid">
      <div class="flex flex-col gap-1">
        <h2 class="font-judul font-bold text-xl leading-7 lg:text-2xl lg:leading-8">${judul}</h2>
        ${keterangan ? `<p class="text-[15px] leading-6 text-tinta-lembut">${keterangan}</p>` : ""}
      </div>
      ${isi}
    </section>
  `;
}

/** Empty-state line inside a report card. */
function htmlKosong(teks) {
  return `<p class="bg-abu rounded-[10px] px-4 py-3 text-[15px] leading-6 text-tinta-isi">${teks}</p>`;
}

/** Section 1a: which services each region's documents cover. */
function htmlMatriks(l) {
  const wilayah = l.matriks[0]?.wilayah.map((c) => c.wilayah) ?? [];
  const baris = l.matriks.map((r) => `
    <tr class="border-t border-garis">
      <th scope="row" class="text-left font-semibold py-3 pr-4 align-top">${escapeHTML(r.layanan)}</th>
      ${r.wilayah.map((c) => {
        const isi = c.bagian
          ? `<span class="flex items-center gap-1.5">${ikon("check-hijau-18", 18)}<span>${c.bagian} kondisi</span></span>
             ${c.adaProsedur ? "" : `<span class="text-[13px] leading-5 text-tinta-lembut">tanpa prosedur</span>`}`
          : `<span class="self-start inline-flex items-center gap-1.5 bg-galat-muda text-galat-tua rounded-full pl-2 pr-2.5 py-0.5 font-semibold">
               ${ikon("x", 18)}Tidak diatur
             </span>`;
        const tiket = c.tiket
          ? `<span class="text-[13px] leading-5 font-semibold text-tiket-tua">${c.tiket} pertanyaan diteruskan</span>`
          : "";
        return `<td class="py-3 pr-4 align-top"><span class="flex flex-col gap-1">${isi}${tiket}</span></td>`;
      }).join("")}
    </tr>
  `).join("");

  return `
    <div class="overflow-x-auto -mx-5 px-5 lg:mx-0 lg:px-0">
      <table class="w-full min-w-[640px] text-[15px] leading-[22px]">
        <caption class="sr-only">Cakupan layanan di dokumen resmi tiap wilayah</caption>
        <thead>
          <tr class="text-left text-[13px] leading-[18px] text-tinta-lembut">
            <th scope="col" class="font-semibold pb-2 pr-4">Layanan</th>
            ${wilayah.map((w) => `<th scope="col" class="font-semibold pb-2 pr-4">${escapeHTML(w)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${baris}</tbody>
      </table>
    </div>
  `;
}

/** Section 1b: forwarded questions the documents could not answer. */
function htmlCelah(l) {
  const daftar = l.celah.length
    ? `<ul class="flex flex-col gap-3">
        ${l.celah.map((c) => `
          <li class="border border-garis rounded-xl p-4 flex gap-4 items-start">
            <span class="shrink-0 min-w-11 h-11 px-2 bg-tiket text-tiket-tua rounded-[10px] flex items-center justify-center font-judul font-bold text-xl"
              aria-label="${c.jumlah} pertanyaan">${c.jumlah}</span>
            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <p class="font-bold">${escapeHTML(c.layanan)} <span class="font-normal text-tinta-lembut">· ${escapeHTML(c.wilayah)}</span></p>
              <span>${htmlBadgeKategori(c)}</span>
              ${c.contoh.map((p) => `<p class="text-sm leading-[22px] text-tinta-isi">“${escapeHTML(p)}”</p>`).join("")}
            </div>
          </li>
        `).join("")}
      </ul>`
    : htmlKosong("Belum ada pertanyaan yang diteruskan karena dokumennya kurang pada periode ini.");

  const gagal = l.gagalCek
    ? `<p class="flex gap-2 items-start text-sm leading-[22px] text-tinta-lembut">
         ${ikon("info-lembut", 18, "shrink-0 mt-0.5")}
         ${l.gagalCek} tiket lain diteruskan karena jawaban AI tidak lolos cek ulang. Itu bukan celah dokumen, jadi tidak dihitung di sini.
       </p>`
    : "";

  return `
    <div class="flex flex-col gap-3">
      <h3 class="font-judul font-bold text-lg leading-[26px]">Pertanyaan yang tidak bisa dijawab dari dokumen</h3>
      ${daftar}
      ${gagal}
    </div>
  `;
}

/** Section 2: answers rated unhelpful. */
function htmlTidakMembantu(l) {
  if (!l.tidakMembantu.length) {
    return htmlKosong(l.ringkasan.penilaian.total
      ? "Tidak ada jawaban yang dinilai tidak membantu pada periode ini."
      : "Belum ada penilaian dari warga pada periode ini.");
  }
  return `
    <div class="overflow-x-auto -mx-5 px-5 lg:mx-0 lg:px-0">
      <table class="w-full min-w-[560px] text-[15px] leading-[22px]">
        <thead>
          <tr class="text-left text-[13px] leading-[18px] text-tinta-lembut">
            <th scope="col" class="font-semibold pb-2 pr-4">Layanan</th>
            <th scope="col" class="font-semibold pb-2 pr-4">Wilayah</th>
            <th scope="col" class="font-semibold pb-2 pr-4 text-right">Tidak membantu</th>
            <th scope="col" class="font-semibold pb-2 text-right">Membantu</th>
          </tr>
        </thead>
        <tbody>
          ${l.tidakMembantu.map((n) => `
            <tr class="border-t border-garis">
              <th scope="row" class="text-left font-semibold py-3 pr-4">${escapeHTML(n.layanan)}</th>
              <td class="py-3 pr-4 text-tinta-isi">${escapeHTML(n.wilayah || "–")}</td>
              <td class="py-3 pr-4 text-right font-bold">${n.tidak}</td>
              <td class="py-3 text-right text-tinta-isi">${n.membantu}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Ranked single-series bars: one accent hue, the number always printed as text.
 * @param {{ kunci: string, jumlah: number }[]} daftar
 * @returns {string}
 */
function htmlBatang(daftar) {
  const maks = Math.max(1, ...daftar.map((d) => d.jumlah));
  return `
    <ol class="flex flex-col gap-3">
      ${daftar.map((d) => `
        <li class="flex flex-col gap-1" title="${escapeHTML(d.kunci)}: ${d.jumlah} pertanyaan">
          <span class="flex items-baseline justify-between gap-3 text-[15px] leading-[22px]">
            <span class="min-w-0">${escapeHTML(d.kunci)}</span>
            <span class="font-bold">${d.jumlah}</span>
          </span>
          <span class="h-2 bg-abu rounded-full overflow-hidden" aria-hidden="true">
            <span class="block h-2 bg-cap rounded-full" style="width: ${(d.jumlah / maks) * 100}%"></span>
          </span>
        </li>
      `).join("")}
    </ol>
  `;
}

/** Section 3: most asked per region, plus questions for other agencies. */
function htmlTerbanyak(l) {
  const kartu = l.terbanyak.map((w) => `
    <div class="border border-garis rounded-xl p-4 lg:p-5 flex flex-col gap-4">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="font-judul font-bold text-lg leading-[26px]">${escapeHTML(w.wilayah)}</h3>
        <span class="text-sm leading-5 text-tinta-lembut">${w.total} pertanyaan</span>
      </div>
      ${w.layanan.length ? htmlBatang(w.layanan) : `<p class="text-[15px] leading-6 text-tinta-lembut">Belum ada pertanyaan.</p>`}
    </div>
  `).join("");

  const luar = l.luarCakupan.length
    ? `
      <div class="flex flex-col gap-3">
        <h3 class="font-judul font-bold text-lg leading-[26px]">Ditanyakan, tapi bukan urusan Disdukcapil</h3>
        <p class="text-[15px] leading-6 text-tinta-lembut">AI sudah mengarahkan warga ke instansi lain. Bisa jadi bahan papan informasi di kantor layanan.</p>
        ${htmlBatang(l.luarCakupan)}
      </div>
    `
    : "";

  return `<div class="grid md:grid-cols-2 gap-4">${kartu}</div>${luar}`;
}

/** Label of a finding's kind, shown next to its data line. */
const JENIS_TEMUAN = {
  tidak_diatur: "Layanan belum diatur",
  kondisi_belum_diatur: "Kondisi belum diatur",
  keadaan_khusus: "Keadaan khusus",
  tanpa_prosedur: "Tanpa prosedur",
  kurang_membantu: "Dinilai tidak membantu",
};

/** Section 4: draft revision proposals, written on request. */
function htmlUsulan() {
  const u = keadaan.usulan;
  const menyusun = keadaan.statusUsulan === "menyusun";
  const galat = keadaan.statusUsulan && !menyusun ? keadaan.statusUsulan : "";

  const tombol = `
    <div class="tidak-dicetak flex flex-wrap items-center gap-3">
      <button type="button" id="susun-usulan" class="tombol-utama px-5 py-2.5 leading-6" ${menyusun ? "disabled" : ""}>
        ${ikon("bot-putih", 18)}<span>${menyusun ? "Menyusun draf…" : u ? "Susun ulang" : "Susun draf usulan"}</span>
      </button>
      ${u ? `<button type="button" id="salin-usulan" class="tombol-garis px-4 py-2.5 leading-6">${ikon("copy-tinta", 18)}<span class="label-tombol">Salin draf</span></button>` : ""}
      ${menyusun ? `<span class="text-sm leading-5 text-tinta-lembut">Biasanya 10–20 detik.</span>` : ""}
    </div>
  `;

  if (!u) {
    return `
      ${galat ? htmlKosong(escapeHTML(galat)) : ""}
      ${tombol}
    `;
  }

  if (!u.jumlahTemuan) {
    return `${htmlKosong("Tidak ada celah dokumen atau keluhan warga pada periode ini, jadi belum ada yang perlu diusulkan.")}${tombol}`;
  }

  let nomor = 0;
  const bagian = u.wilayah.map((w) => `
    <section class="border border-garis rounded-xl p-4 lg:p-5 flex flex-col gap-4 break-inside-avoid">
      <div class="flex gap-3 items-start">
        <span class="shrink-0 bg-cap-muda rounded-[10px] size-10 flex items-center justify-center">${ikon("landmark", 20)}</span>
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <h3 class="font-judul font-bold text-lg leading-[26px]">
            ${w.wilayah === "Lintas wilayah" ? "Lintas wilayah Bandung Raya" : `Kepada: Disdukcapil ${escapeHTML(w.wilayah)}`}
          </h3>
          <p class="text-sm leading-[22px] text-tinta-lembut">Dokumen: ${escapeHTML(w.dokumen)}</p>
        </div>
      </div>
      <ol class="flex flex-col gap-4">
        ${w.usulan.map((b) => `
          <li class="flex gap-3 items-start">
            <span class="shrink-0 bg-abu rounded-full size-7 flex items-center justify-center text-sm font-bold">${++nomor}</span>
            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <p class="font-bold leading-6">${escapeHTML(b.usulan)}</p>
              <p class="text-[15px] leading-6 text-tinta-isi">${escapeHTML(b.alasan)}</p>
              <p class="bg-abu rounded-lg px-3 py-2 text-sm leading-[22px] text-tinta-isi">
                <span class="font-semibold">Data · ${escapeHTML(JENIS_TEMUAN[b.jenis] ?? b.jenis)}:</span> ${escapeHTML(b.fakta)}
              </p>
              ${b.otomatis ? `<p class="text-[13px] leading-5 text-tinta-lembut">Kalimat templat, karena kalimat AI untuk butir ini tidak lolos cek angka.</p>` : ""}
            </div>
          </li>
        `).join("")}
      </ol>
    </section>
  `).join("");

  return `
    <div class="flex flex-col gap-4">
      <p class="leading-7 text-tinta-isi">${escapeHTML(u.pengantar)}</p>
      ${bagian}
      <p class="leading-7 text-tinta-isi">${escapeHTML(u.penutup)}</p>
      <p class="flex gap-2 items-start text-sm leading-[22px] text-tinta-lembut">
        ${ikon("info-lembut", 18, "shrink-0 mt-0.5")}
        ${u.disusunAi ? "Kalimat usulan ditulis AI (watsonx lewat Langflow)." : "AI belum bisa dipakai, jadi semua kalimat memakai templat."}
        Temuan dan angka di kotak “Data” diambil langsung dari laporan ini, bukan dari AI. Periksa dan sunting dulu sebelum dikirim.
        Disusun ${escapeHTML(waktuLengkap(u.dibuat))}.
      </p>
      ${galat ? htmlKosong(escapeHTML(galat)) : ""}
      ${tombol}
    </div>
  `;
}

/**
 * The draft as plain text, for pasting into a letter.
 * @param {Record<string, any>} u
 * @returns {string}
 */
function teksUsulan(u) {
  let nomor = 0;
  const baris = [`DRAF USULAN REVISI STANDAR PELAYANAN (${u.periode})`, "", u.pengantar, ""];
  u.wilayah.forEach((w) => {
    baris.push(w.wilayah === "Lintas wilayah" ? "Lintas wilayah Bandung Raya" : `Kepada: Disdukcapil ${w.wilayah}`);
    baris.push(`Dokumen: ${w.dokumen}`);
    w.usulan.forEach((b) => {
      baris.push(`${++nomor}. ${b.usulan}`, `   Alasan: ${b.alasan}`, `   Data: ${b.fakta}`);
    });
    baris.push("");
  });
  baris.push(u.penutup);
  return baris.join("\n");
}

/** Re-render only the proposals card. */
function renderUsulan() {
  const el = document.getElementById("isi-usulan");
  if (el) el.innerHTML = htmlUsulan();
}

/** The whole report. */
function renderLaporan() {
  const l = keadaan.laporan;
  if (!l) return;
  const r = l.ringkasan;
  const persenMembantu = r.penilaian.total ? `${Math.round((r.penilaian.membantu / r.penilaian.total) * 100)}%` : "–";

  isiLaporan.innerHTML = `
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      ${htmlKpi({ ikonNama: "bot", ukuranIkon: 22, latar: "bg-lengkap-muda", angka: r.dijawabAi, label: "pertanyaan dijawab AI", sub: `dari ${r.pertanyaan} pertanyaan` })}
      ${htmlKpi({ ikonNama: "inbox", ukuranIkon: 22, latar: "bg-tiket", angka: r.diteruskan, label: "diteruskan ke petugas" })}
      ${htmlKpi({ ikonNama: "check-circle", ukuranIkon: 24, latar: "bg-lengkap-muda", angka: r.berkasDitolak, label: "berkas karangan AI dibuang", sub: `oleh pengecekan ulang, di ${r.jawabanDenganKarangan} jawaban` })}
      ${htmlKpi({ ikonNama: "thumbs-up", ukuranIkon: 18, latar: "bg-cap-muda", angka: persenMembantu, label: "dinilai membantu", sub: `${r.penilaian.total} penilaian warga` })}
    </div>

    ${htmlKartu(
      "1. Layanan yang belum diatur di dokumen resmi",
      "Dihitung dari dokumen yang dipakai AI. Di sel “Tidak diatur”, AI tidak bisa menjawab dan setiap pertanyaan diteruskan ke petugas. Ini bahan untuk melengkapi standar pelayanan atau peraturan daerah.",
      htmlMatriks(l) + htmlCelah(l)
    )}

    ${htmlKartu(
      "2. Jawaban yang dinilai tidak membantu",
      "Dari tombol “Apakah informasi ini membantu?” di halaman Tanya dan Cek tiket.",
      htmlTidakMembantu(l)
    )}

    ${htmlKartu(
      "3. Pertanyaan terbanyak per wilayah",
      "Riwayat ini hanya mencatat wilayah dan layanan, tanpa isi pertanyaan warga.",
      htmlTerbanyak(l)
    )}

    ${htmlKartu(
      "4. Draf usulan revisi untuk pemda",
      "Temuan di atas diubah menjadi usulan perbaikan dokumen per wilayah: dari pertanyaan warga, ke data, ke perbaikan kebijakan.",
      `<div id="isi-usulan">${htmlUsulan()}</div>`
    )}

    <p class="text-[13px] leading-5 text-tinta-lembut">
      Laporan dibuat ${escapeHTML(waktuLengkap(l.dibuat))} · ${l.periodeHari ? `${l.periodeHari} hari terakhir` : "semua data"}
    </p>
  `;
}

/* ==========================================================
   7. VIEWS
   ========================================================== */

/** @param {string} pesan — error under the key form, "" for none */
function tampilkanFormKunci(pesan) {
  [tampilanTiket, tampilanLaporan].forEach((el) => el.classList.add("hidden"));
  tampilanKunci.classList.remove("hidden");
  galatKunci.textContent = pesan;
  galatKunci.classList.toggle("hidden", !pesan);
  inputKunci.focus();
}

/** Show the view named in the hash and load its data. */
async function bukaTampilan() {
  const nama = location.hash === "#laporan" ? "laporan" : "tiket";
  tampilanKunci.classList.add("hidden");
  tampilanTiket.classList.toggle("hidden", nama !== "tiket");
  tampilanLaporan.classList.toggle("hidden", nama !== "laporan");
  tautanTampilan.forEach((a) => {
    if (a.dataset.tampilan === nama) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  try {
    if (nama === "tiket") {
      await muatTiket();
      if (!keadaan.dipilih) keadaan.dipilih = tiketTersaring()[0]?.kode ?? null;
      renderDaftar();
      renderDetail();
    } else {
      await muatLaporan();
      renderLaporan();
    }
  } catch (err) {
    if (err.message === "perlu kunci") return;
    const sasaran = nama === "tiket" ? daftarTiket : isiLaporan;
    sasaran.innerHTML = htmlKosong(`Data belum bisa dimuat: ${escapeHTML(err.message)}`);
  }
}

/* ==========================================================
   8. EVENT LISTENERS
   ========================================================== */

window.addEventListener("hashchange", bukaTampilan);

formKunci.addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    sessionStorage.setItem(KUNCI_SESI, inputKunci.value.trim());
  } catch {
    // Storage blocked — nothing more we can do
  }
  inputKunci.value = "";
  bukaTampilan();
});

document.getElementById("tombol-keluar").addEventListener("click", () => {
  try {
    sessionStorage.removeItem(KUNCI_SESI);
  } catch {
    // Nothing stored
  }
  location.href = "/";
});

tombolSaring.forEach((tombol) => {
  tombol.addEventListener("click", () => {
    keadaan.saring = tombol.dataset.status;
    keadaan.dipilih = tiketTersaring()[0]?.kode ?? null;
    renderDaftar();
    renderDetail();
  });
});

cariTiket.addEventListener("input", () => {
  keadaan.cari = cariTiket.value;
  renderDaftar();
});

daftarTiket.addEventListener("click", (e) => {
  const tombol = e.target.closest("button[data-kode]");
  if (!tombol) return;
  keadaan.dipilih = tombol.dataset.kode;
  renderDaftar();
  renderDetail();
  // On phones the detail sits under the list
  if (!window.matchMedia("(min-width: 1024px)").matches) {
    detailTiket.scrollIntoView({ block: "start" });
  }
  detailTiket.focus({ preventScroll: true });
});

detailTiket.addEventListener("input", (e) => {
  if (e.target.id !== "input-jawaban") return;
  document.getElementById("hitung-jawaban").textContent = `${e.target.value.length} / ${MAX_JAWABAN}`;
});

detailTiket.addEventListener("submit", async (e) => {
  if (e.target.id !== "form-jawaban") return;
  e.preventDefault();
  const kode = e.target.dataset.kode;
  const jawaban = document.getElementById("input-jawaban").value.trim();
  if (!jawaban) {
    pesanJawaban("Tulis dulu jawabannya.", true);
    return;
  }

  try {
    await api(`/api/petugas/tiket/${encodeURIComponent(kode)}/jawab`, {
      method: "POST",
      body: JSON.stringify({ jawaban }),
    });
    await muatTiket();
    // The answered ticket moves to the other tab; open the next waiting one
    keadaan.dipilih = tiketTersaring()[0]?.kode ?? null;
    renderDaftar();
    renderDetail();
  } catch (err) {
    if (err.message !== "perlu kunci") pesanJawaban(`Jawaban belum terkirim: ${err.message}`, true);
  }
});

detailTiket.addEventListener("click", async (e) => {
  if (e.target.closest("#simpan-draf") === null) return;
  const form = document.getElementById("form-jawaban");
  const draf = document.getElementById("input-jawaban").value;

  try {
    await api(`/api/petugas/tiket/${encodeURIComponent(form.dataset.kode)}/draf`, {
      method: "POST",
      body: JSON.stringify({ draf }),
    });
    const t = keadaan.tiket.find((x) => x.kode === form.dataset.kode);
    if (t) t.draf = draf;
    pesanJawaban(`Draf tersimpan ${jam(new Date())}. Warga belum melihatnya.`);
  } catch (err) {
    if (err.message !== "perlu kunci") pesanJawaban(`Draf belum tersimpan: ${err.message}`, true);
  }
});

periodeLaporan.addEventListener("change", async () => {
  keadaan.periode = Number(periodeLaporan.value);
  // A draft belongs to its period
  keadaan.usulan = null;
  keadaan.statusUsulan = "";
  try {
    await muatLaporan();
    renderLaporan();
  } catch (err) {
    if (err.message !== "perlu kunci") isiLaporan.innerHTML = htmlKosong(`Laporan belum bisa dimuat: ${escapeHTML(err.message)}`);
  }
});

document.getElementById("cetak-laporan").addEventListener("click", () => window.print());

// Draft proposals: written on request, since each one is an LLM call
isiLaporan.addEventListener("click", async (e) => {
  const tombol = e.target.closest("button");
  if (!tombol) return;

  if (tombol.id === "susun-usulan") {
    keadaan.statusUsulan = "menyusun";
    renderUsulan();
    try {
      keadaan.usulan = await api("/api/petugas/usulan", {
        method: "POST",
        body: JSON.stringify({ hari: keadaan.periode }),
      });
      keadaan.statusUsulan = "";
    } catch (err) {
      keadaan.statusUsulan = err.message === "perlu kunci" ? "" : `Draf belum bisa disusun: ${err.message}`;
    }
    renderUsulan();
  } else if (tombol.id === "salin-usulan" && keadaan.usulan) {
    const label = tombol.querySelector(".label-tombol");
    try {
      await navigator.clipboard.writeText(teksUsulan(keadaan.usulan));
      label.textContent = "Tersalin";
    } catch {
      label.textContent = "Gagal menyalin";
    }
    setTimeout(() => { label.textContent = "Salin draf"; }, 2000);
  }
});

/* ==========================================================
   9. INITIALISE
   ========================================================== */

bukaTampilan();
