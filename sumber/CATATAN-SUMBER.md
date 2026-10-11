# Catatan sumber knowledge base — Bandung Raya

Dikumpulkan 7 Oktober 2026 untuk memperluas Tanya Layanan dari Kota Cimahi ke Bandung Raya
(Kota Bandung, Kabupaten Bandung, Kabupaten Bandung Barat, Kota Cimahi).

## Temuan utama

Persyaratan dokumen kependudukan **diatur secara nasional** (Perpres 96/2018 dan Permendagri
108/2019), jadi daftar berkas di keempat daerah hampir sama. Yang berbeda per daerah:
tempat layanan, aplikasi daring, kanal pengaduan, lama proses, dan alur prosedur.

## Berkas di folder ini

| File | Isi | Asal | Kegunaan |
|---|---|---|---|
| `spp-kota-bandung-web.md` | Standar Pelayanan Disdukcapil Kota Bandung, 25 layanan, disusun ulang dari data situs (situs tidak menyediakan PDF). Dibuat ulang dengan `npm run ambil-spp-bandung` | [standarpelayanan.bandung.go.id](https://standarpelayanan.bandung.go.id/unit/116/pelayanan) | **Utama Kota Bandung** (lebih baru dari PDF 2022: aplikasi SALAMAN, syarat KK hilang/rusak terbaru). Nama petugas sengaja tidak disalin |
| `spbdg-116-pelayanan.json` | Data mentah situs di atas (tanpa nama petugas) | idem | Arsip / audit |
| `spp-kota-bandung-2022.pdf` / `.txt` | Kepdis Disdukcapil Kota Bandung No. TL.03/1315-Disdukcapil (20 Apr 2022), Standar Pelayanan Publik, 144 hlm, 25 layanan | [ppid.bandung.go.id](https://ppid.bandung.go.id/storage/ppid_pembantu/informasi_berkala/PztGDeZh3Vb4IPCGvZvtxiyRtvHX9PytdWMUHWSd.pdf) | Pelengkap Kota Bandung: **jangka waktu (hari kerja)**, yang tidak ada di situs. Prosedurnya masih menyebut aplikasi PEMUDA (lama) |
| `perbup-kab-bandung-2-2019.md` | Perbup Kab. Bandung No. 2/2019 tentang Persyaratan dan Tata Cara Pendaftaran Penduduk dan Pencatatan Sipil (teks dari pasal.id) | [pasal.id](https://pasal.id/peraturan/perbup/perbup-kab-bandung-2-2019) | **Utama Kab. Bandung**: persyaratan + tata cara |
| `perda-kbb-3-2023-adminduk.pdf` / `.txt` | Perda Kab. Bandung Barat No. 3/2023 tentang Penyelenggaraan Administrasi Kependudukan, 51 hlm | [peraturan.bpk.go.id](https://peraturan.bpk.go.id/Download/348778/Perda%20KBB%203%202023%20Penyelenggaraan%20Adm%20Kependudukan.pdf) | **Utama KBB**: persyaratan per layanan (Pasal 16 dst.) |
| `jabar-layanan-3273-kota-bandung.pdf` | Daftar inovasi & kanal layanan Kota Bandung (e-SPASI, Anjungan KIA, Mepeling, …) | disdukcapil.jabarprov.go.id, Jan 2023 | Kanal daring / WhatsApp — **perlu verifikasi** |
| `jabar-layanan-3204-kab-bandung.pdf` | Inovasi Kab. Bandung (SATUKAN HATI one day service, PANDAWA via WA, DOKKAR) + nomor WA per layanan | disdukcapil.jabarprov.go.id, Jan 2023 | Kanal — **perlu verifikasi** (era pandemi) |
| `jabar-layanan-3217-bandung-barat.pdf` | Inovasi KBB (DARLING keliling, SIDILAN daring, antar KTP/KIA via Pos, PANGERAN) + hotline pengaduan | disdukcapil.jabarprov.go.id, Jan 2023 | Kanal — **perlu verifikasi** |
| `jabar-layanan-3277-kota-cimahi.pdf` | Inovasi Kota Cimahi + nomor WA per layanan | disdukcapil.jabarprov.go.id, Jan 2023 | Pelengkap KB Cimahi yang sudah ada |

Situs disdukcapil.jabarprov.go.id memblokir akses dari luar Indonesia; unduh dari jaringan Indonesia.

## Cakupan per daerah (untuk layanan yang ada di KB Cimahi)

| | Kota Cimahi | Kota Bandung | Kab. Bandung | Bandung Barat |
|---|---|---|---|---|
| Persyaratan KK / KTP-el / KIA / Akta Lahir / Pindah | ✅ SPP 2024 | ✅ SPP 2022 | ✅ Perbup 2/2019 | ✅ Perda 3/2023 |
| Prosedur | ✅ | ✅ | ✅ (tata cara umum) | ❌ (merujuk NSPK pusat) |
| Lama proses | ✅ | ✅ | 🟡 sama dengan Cimahi | 🟡 sama dengan Cimahi |
| Biaya | ✅ gratis | ✅ gratis | ❌ tidak tertulis | ✅ "gratis" (Pasal 77) |
| Alamat kantor | ✅ | ✅ Jl. Ambon No. 1B | 🟡 Jl. Raya Soreang KM 17 | ✅ Komplek Pemda KBB, Ngamprah (situs resmi) |
| Jam layanan | ✅ | 🟡 sama dengan Cimahi | 🟡 sama dengan Cimahi | 🟡 sama dengan Cimahi |

🟡 = informasi dari tim (7 Okt 2026): jam layanan dan lama proses sama dengan Kota Cimahi.
Belum ada dokumen resmi daerahnya, jadi di knowledge base sumbernya ditulis sebagai informasi tim,
bukan sebagai SPP daerah tersebut. Kota Bandung tetap memakai lama proses dari SPP-nya sendiri.
| Kanal pengaduan | ✅ | ✅ email, (022) 4209891, @disdukcapilbdg | ⚠️ WA 2023 | ✅ email, SP4N-LAPOR!, SIDILAN (situs resmi); ⚠️ hotline 2023 |

## Yang masih perlu dicari / ditanyakan langsung

1. ~~Alamat kantor Disdukcapil Kab. Bandung dan KBB~~ — sudah (11 Okt 2026): Kab. Bandung dari informasi tim, KBB dari
   informasi tim dan cocok dengan halaman Kontak situs resmi. Alamat Kab. Bandung belum dicek ke dokumen resmi.
2. ~~Versi terbaru SPP Kota Bandung~~ — sudah: diambil dari standarpelayanan.bandung.go.id (lihat `spp-kota-bandung-web.md`).
3. Nomor WhatsApp / hotline di dokumen Jabar (2023) masih aktif atau tidak.

Bagian yang datanya tidak ada **jangan diisi tebakan** — di web, bagian "Cara mengurus" / baris
info otomatis disembunyikan kalau knowledge base tidak memuatnya.

## Pencarian lain yang tidak dipakai

- LKIP Disdukcapil Kota Bandung 2019 & 2021 (ppid.bandung.go.id) — laporan kinerja, bukan persyaratan.
- Situs disdukcapil.bandungbaratkab.go.id (dicek ulang 11 Okt 2026) — yang dipakai hanya alamat, email, kanal SP4N-LAPOR!,
  SIDILAN (`/online`), dan Instagram @disdukcapilkbb. Sisanya tampak isi contoh templat: telepon "(022) 1234567",
  semua tautan unduhan (formulir, panduan akta, "Perda No. 5 Tahun 2024 tentang Adminduk") berupa `#`, dan Perda
  5/2024 itu tidak ditemukan di JDIH/BPK. Halaman persyaratan tidak berisi persyaratan, jadi KB KBB tetap memakai Perda 3/2023.
- Ringkasan Perpres 96/2018: [setkab.go.id](https://setkab.go.id/perpres-no-962018-inilah-persyaratan-pendaftaran-biodata-penduduk-dan-penerbitan-kk/) — cadangan nasional.
