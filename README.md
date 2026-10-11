# Tanya Layanan

Web untuk warga Bandung Raya (Kota Bandung, Kabupaten Bandung, Kabupaten Bandung Barat, Kota Cimahi):
tanya persyaratan dokumen kependudukan (KK, KTP-el, KIA, akta kelahiran, pindah), dapat daftar
berkas yang bisa dicentang, lengkap dengan sumber resminya. Pertanyaan yang tidak bisa dijawab dari
dokumen resmi diteruskan ke petugas, dan halaman Petugas merangkumnya jadi laporan celah informasi
untuk pemda.
Desain: Figma "Tanya Layanan – Desain Web", frame "Redesign v2" (Web 01–09, termasuk versi HP).

## Cara menjalankan

1. Nyalakan Langflow (perlu akses folder Chroma di `C:\Magang`):

   ```powershell
   $env:LANGFLOW_RESTRICT_LOCAL_FILE_ACCESS="false"; C:\langflow\langflow-venv\Scripts\langflow.exe run --host 127.0.0.1 --port 7860
   ```

2. Buat API key di Langflow (**Settings → Langflow API Keys → Add New**), lalu tempel ke
   `LANGFLOW_API_KEY` di file `.env` (salin dari `.env.example` kalau belum ada).

   Kredensial watsonx (region `jp-tok`) disimpan sebagai Global Variables Langflow, bukan di `.env`:
   `WATSONX_APIKEY2` (Credential) dan `WATSONX_PROJECT_ID2` (Generic). Keenam flow di `langflow/`
   membaca dua variabel ini.

3. Jalankan web (Node.js 22 ke atas, tanpa `npm install`):

   ```powershell
   npm start
   ```

   Buka http://127.0.0.1:3000. Halaman petugas ada di http://127.0.0.1:3000/petugas.html
   (lihat [Halaman Petugas](#halaman-petugas)).

## Cara kerja

```
Browser ──POST /api/tanya──► server.js
                               0. wilayah  : dari pertanyaan ("warga Soreang"), pilihan warga sebelumnya, atau tanya balik
                               1. tl-router: pilih SATU judul dari daftar judul wilayah itu (lewat tweak {daftar_judul})
                               2. tl-cari  : Chroma kembalikan 8 bagian terdekat → server ambil yang judulnya PERSIS sama
                               3. tl-susun : AI susun JSON dari bagian itu (teks bagian lewat tweak {context})
                               4. cek ulang: src/dokumen.js
        ◄── NDJSON per tahap ──┘
```

**Paket peristiwa hidup.** Warga sering tahu kejadiannya, bukan nama layanannya ("anak saya baru
lahir, apa yang perlu diurus?"). Pertanyaan seperti itu, yaitu peristiwa tanpa menyebut dokumen tertentu
(`src/paket.js`: lahir/lahiran, menikah/habis nikah, pindah/pindahan, meninggal, cerai), lebih dulu masuk ke flow **tl-rencana**. Flow ini menyusun urutan layanan dari judul
semua wilayah, misalnya akta kelahiran → KK penambahan anggota → KIA. Untuk pindah rumah, flow ini
bertanya dulu pindahnya ke mana, dan untuk kematian bertanya apakah yang meninggal kepala keluarga. Setelah itu:

- Judul hanya diterima kalau **persis** ada di `kb/`, atau hanya kehilangan ekor "bagi Penduduk WNI …"
  (dipilih versi WNI). Judul lain yang mirip ditolak, karena biasanya itu kondisi lain (misalnya
  "KTP-el baru" untuk perubahan status kawin). Satu pengecualian berdasar catatan `kb/`: wilayah tanpa
  bagian "KK penambahan anggota keluarga" memakai "KK karena perubahan data" untuk anak yang baru lahir. Langkah yang tidak ada di dokumen
  wilayah itu diteruskan ke petugas (`tidak_diatur`), seperti KIA di KBB.
- Tahap 2–4 (cari → susun → cek ulang) dijalankan untuk semua layanan **sekaligus**.
- Berkas digabung tanpa dobel. Dokumen yang dihasilkan langkah sebelumnya (akta, KK baru, surat
  pindah) tidak masuk checklist, tapi ditandai "didapat dari langkah N". Ketergantungan antarlangkah
  diambil dari persyaratan di dokumen, bukan dari tebakan AI.
- Kalau ternyata hanya satu layanan, pertanyaannya kembali ke jalur router biasa.

- **Kenapa ada langkah 2 terpisah:** bagian KK/KTP antar daerah hampir sama persis, jadi pencarian
  vektor saja hanya menaruh bagian yang benar di peringkat 1 untuk 42 dari 56 bagian. Bagian yang benar
  selalu ada di 8 teratas (56/56), jadi server memilihnya berdasarkan judul yang persis sama
  (diukur ulang dengan `npm run evaluasi`, lihat [Evaluasi](#evaluasi)).
- **Tahap proses (Web 02) asli**, bukan animasi: server mengirim `mencari → layanan → mengecek → hasil`.
- **Dicek ulang otomatis** (`src/dokumen.js`): setiap berkas harus ditemukan di bagian *Persyaratan*
  dokumen, langkah di bagian *Prosedur*, angka/jam di teks dokumen. Yang tidak lolos dibuang.
  Keadaan khusus yang tidak tercantum di dokumen (misalnya "buku nikah hilang") → diteruskan ke petugas.
- **Tempat, Biaya, Lama proses, Sumber** diambil langsung dari dokumen, bukan dari AI.
- **Situs instansi lain** (Imigrasi, Korlantas, BPJS, …) dari daftar tetap di `src/tanya.js`, bukan dari AI.
- **NIK** (16 digit) disembunyikan sebelum dikirim ke Langflow atau disimpan.
- Pertanyaan warga **tidak disimpan** di riwayat pesan Langflow (`should_store_message` dimatikan).

| Hasil | Layar | Kapan |
|---|---|---|
| `jawaban` | Web 03 | Layanan ketemu dan lolos cek ulang |
| `tanya_balik` | Web 04 | Wilayah belum diketahui, layanan belum pasti, atau berkas bergantung keadaan warga |
| `luar_cakupan` | Web 05 | Bukan urusan Disdukcapil (paspor, SIM, BPJS, …) |
| `teruskan` | Web 06 | AI tidak yakin, atau layanannya tidak ada di knowledge base wilayah itu → tiket petugas |
| `paket` | Web 03 (urutan langkah + checklist gabungan) | Peristiwa hidup yang butuh dua layanan atau lebih |

Setiap tiket menyimpan **kategori** alasannya, supaya laporan bisa membedakan celah dokumen dari
kesalahan AI: `tidak_diatur` (layanan tidak ada di dokumen wilayah itu), `keadaan_khusus` (layanannya
ada, keadaan warga tidak), `gagal_cek` (jawaban AI tidak lolos cek ulang), `tidak_dikenali` (router
tidak menemukan layanan).

## Evaluasi

```powershell
npm run evaluasi            # dua-duanya (perlu Langflow menyala)
npm run evaluasi -- cari    # hanya A, tanpa panggilan LLM
npm run evaluasi -- tanya   # hanya B
```

Hasil lengkap per bagian dan per pertanyaan ditulis ke `evaluasi/hasil-terakhir.md` dan `.json`.
Angka A dari run 7 Oktober 2026, angka B dari run 8 Oktober 2026; koleksi `tanya_layanan_v10`.
`evaluasi/hasil-terakhir.md` saat ini hanya berisi bagian B (run `-- tanya`); jalankan `npm run evaluasi`
untuk menulis ulang keduanya.

**A. Pencarian bagian dokumen** (56 bagian di `kb/`, dicari dengan kepala bagiannya, persis seperti server)

| Cara | Bagian yang benar |
|---|---|
| Pencarian vektor saja (peringkat 1 Chroma) | 42 dari 56 (75%) |
| Pilih judul persis dari 8 teratas (cara server) | 56 dari 56 (100%) |

Yang meleset di peringkat 1 hampir semuanya tertukar antardaerah (Kabupaten Bandung ↔ Kota Bandung)
atau antarkondisi yang mirip (KTP-el baru ↔ KTP-el pindah datang).

**B. Pertanyaan uji** (`evaluasi/pertanyaan-uji.json`, 27 pertanyaan: empat wilayah, lima jenis hasil termasuk
7 paket peristiwa hidup, tanpa membuat tiket sungguhan). Dihitung benar kalau jenis hasil **dan** bagian dokumennya
sesuai harapan; untuk paket, semua langkahnya harus benar dan berurutan.

Angka di bawah dari **23 pertanyaan pertama**. Empat kasus terakhir (lahiran, habis nikah, dan dua kasus
kematian) ditambahkan sesudah run itu dan **belum dievaluasi**, karena kuota token watsonx habis.

| Ukuran | Hasil (23 pertanyaan) |
|---|---|
| Hasil sesuai harapan | 21 dari 23 (91%) |
| Berkas yang lolos cek ulang dan ditampilkan ke warga | 64 |
| Berkas karangan AI yang dibuang cek ulang | 0 |
| Langkah "Cara mengurus" karangan AI yang dibuang | 2 |

Ketiga paket lolos: kelahiran di Cimahi (akta → KK penambahan anggota → KIA), kelahiran di Ngamprah
(KIA tercatat tidak tercantum di dokumen KBB), dan pindah rumah (perencana bertanya tujuan dulu).

Dua yang tidak sesuai (sama dengan run sebelumnya):
- *"Warga Soreang, KK rusak kena banjir"* → diteruskan ke petugas, padahal dokumen mengatur KK rusak.
  "Kena banjir" dianggap keadaan khusus; terlalu hati-hati, bukan salah informasi.
- *"Warga Cimahi, buku nikah hilang, bisa urus KK baru?"* → AI bertanya balik dulu, bukan langsung
  meneruskan ke petugas.

Pada 23 pertanyaan ini AI tidak mengarang berkas sama sekali; cek ulang hanya membuang dua langkah.
Cek ulang tetap dipasang sebagai pengaman, dan jumlah yang dibuang saat dipakai warga tercatat di
laporan halaman Petugas.

## Knowledge base

Satu file per wilayah di `kb/`, bagian dipisah baris `=====`. Sumber dan catatan kelengkapan ada di
[`sumber/CATATAN-SUMBER.md`](sumber/CATATAN-SUMBER.md).

| File | Bagian | Sumber utama |
|---|---|---|
| `kb/kota-cimahi.md` | 21 | SPP Disdukcapil Kota Cimahi 2024 |
| `kb/kota-bandung.md` | 12 | standarpelayanan.bandung.go.id (+ SPP 2022 untuk lama proses) |
| `kb/kabupaten-bandung.md` | 13 | Perbup Kab. Bandung No. 2/2019 |
| `kb/kabupaten-bandung-barat.md` | 10 | Perda KBB No. 3/2023 (tanpa KIA dan prosedur — tidak ada di Perda) |

Setelah mengubah isi `kb/`:

```powershell
npm run ingest-kb -- tanya_layanan_v11   # ingest ke koleksi BARU
```

lalu set `KB_KOLEKSI=tanya_layanan_v11` di `.env` dan restart `npm start`. Daftar judul untuk router
dibaca langsung dari `kb/`, jadi tidak perlu mengubah prompt di Langflow.

Data Kota Bandung bisa diambil ulang dari situs resminya dengan `npm run ambil-spp-bandung`
(hasilnya ke `sumber/spp-kota-bandung-web.md`, lalu salin perubahan yang relevan ke `kb/kota-bandung.md`).

## Halaman Petugas

Buka `/petugas.html`. Halaman ini sengaja tidak ditautkan dari halaman warga.

- **Tiket dari warga** (Web 08): angka hari ini, saringan belum/sudah dijawab, pencarian kode atau isi
  pertanyaan, alasan diteruskan, **Kirim jawaban** dan **Simpan draf**. Warga melihat jawabannya di
  halaman **Cek tiket**.
- **Laporan untuk pemda** (`/petugas.html#laporan`), dengan pilihan periode dan tombol Cetak:
  1. *Layanan yang belum diatur di dokumen resmi*: matriks layanan × wilayah, dihitung langsung dari
     `kb/` (misalnya KIA dan Pindah Datang tidak diatur di Perda KBB, dan dokumen KBB tanpa prosedur),
     ditambah pertanyaan warga yang diteruskan karena dokumennya kurang.
  2. *Jawaban yang dinilai tidak membantu*, dari tombol Ya/Tidak di halaman Tanya dan Cek tiket.
  3. *Pertanyaan terbanyak per wilayah*, plus pertanyaan yang ternyata urusan instansi lain.
  4. *Draf usulan revisi untuk pemda* (tombol **Susun draf usulan**): temuan dari bagian 1–2 diubah
     menjadi usulan perbaikan dokumen, dikelompokkan per Disdukcapil beserta dokumen dasarnya.
     Server (`src/usulan.js`) yang menyusun temuan dan angkanya, misalnya "KIA tidak diatur di Perda KBB,
     1 pertanyaan warga diteruskan". Flow **tl-usulan** hanya menulis kalimat usulan dan alasannya.
     Kalimat AI yang memuat angka di luar data diganti kalimat templat, dan butirnya diberi tanda.
     Hasilnya bisa disalin atau dicetak, lalu wajib diperiksa petugas; tidak ada yang dikirim otomatis.

**Akses:**
- Dari komputer yang menjalankan server: langsung terbuka, tanpa kunci.
- Dari komputer atau HP lain: isi `PETUGAS_KUNCI` (dan `HOST=0.0.0.0`) di `.env`, restart
  `npm start`, lalu masukkan kunci itu di halaman petugas. Kunci hanya tersimpan selama tab terbuka.
  Kalau `PETUGAS_KUNCI` kosong, akses dari komputer lain ditolak.

**Data untuk laporan** ada di `data/` (tidak masuk git):
`tiket.json` (pertanyaan yang diteruskan, NIK disamarkan), `penilaian.json`, dan `riwayat.json`
(satu baris per jawaban: wilayah, layanan, jenis hasil, jumlah berkas yang dibuang cek ulang,
**tanpa isi pertanyaan**).

Tiket juga masih bisa dijawab dari terminal:

```powershell
npm run jawab-tiket                                   # daftar tiket yang menunggu
npm run jawab-tiket -- TL-7K2QXM "Jawaban petugas…"   # jawab satu tiket
```

## Struktur

```
server.js                  server HTTP + API (tanpa dependensi)
src/langflow.js            klien Langflow /api/v1/run + ID komponen tiap flow
src/kb.js                  baca kb/*.md, daftar judul per wilayah, deteksi wilayah dari pertanyaan
src/tanya.js               alur wilayah → (rencana) → router → cari → susun → cek ulang
src/paket.js               deteksi peristiwa hidup, judul persis dari rencana, gabung berkas tanpa dobel
src/dokumen.js             baca bagian KB + pengecekan ulang
src/penyimpanan.js         tiket, penilaian & riwayat jawaban (data/*.json)
src/laporan.js             angka halaman Petugas + laporan celah informasi untuk pemda
src/usulan.js              temuan dari laporan → draf usulan revisi per pemda (tl-usulan + cek angka)
public/                    front end (HTML + Tailwind CDN + JS biasa)
public/petugas.html        halaman Petugas: tiket + laporan
evaluasi/                  pertanyaan uji + hasil evaluasi terakhir
kb/                        knowledge base per wilayah
sumber/                    dokumen sumber + catatan
langflow/*.json            ekspor flow tl-router, tl-cari, tl-susun, tl-rencana, tl-usulan, tl-ingest (bisa di-import ulang;
                           tiap flow punya sticky note identitas dan posisinya di alur end-to-end)
scripts/jawab-tiket.js     jawab tiket dari terminal
scripts/evaluasi.js        ukur pencarian (56 bagian) dan 27 pertanyaan uji
scripts/ingest-kb.js       masukkan kb/ ke Chroma lewat Langflow
scripts/ambil-spp-bandung.js  ambil standar pelayanan Kota Bandung dari situsnya
```

## Belum untuk produksi

- Tailwind lewat CDN (sesuai gaya proyek); untuk publik sebaiknya di-build.
- Tiket disimpan di file JSON lokal, belum ada batas jumlah permintaan.
- Halaman petugas memakai satu kunci bersama (`PETUGAS_KUNCI`), belum login per petugas.
