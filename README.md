# Ruang Kerja

App desktop untuk kerja bareng di **satu folder project** lewat WiFi/LAN.
Fitur kolaborasi folder dan antrean berjalan di jaringan lokal. Fitur AI dan live web research bersifat opsional, memerlukan internet, dan dapat mengirim prompt, konteks terpilih, atau lampiran ke provider AI/situs web yang dipakai.

## Fitur

- **Folder project bersama** — sinkron dua arah antar laptop di LAN.
- **Antrian giliran** — "Ambil Giliran" / "Lepas Giliran"; yang menunggu dapat notifikasi.
- **Deteksi IDE otomatis** — VS Code, Cursor, Antigravity, Windsurf, Trae, Zed, Sublime,
  JetBrains, Visual Studio; tombol "Buka di IDE" membuka folder project di IDE itu.
  Rescan kalau IDE baru di-install.
- **Deteksi framework** — Next.js, Vite, Astro, Nuxt, SvelteKit, Angular, Gatsby, CRA,
  Remix, Laravel, Django, dan lainnya.
- **Kontrol dev server dari app** — host menyalakan `npm run dev` (dsb.) tanpa PowerShell;
  saat aktif, tab **Website** terbuka untuk semua anggota lewat IP host.
- Beda IDE antar anggota tidak masalah — yang dibagi adalah foldernya, bukan IDE-nya.
- **Agentic Coding AI (opsional)** — chat dengan model dari provider terkonfigurasi, pemilih model berdasarkan katalog provider, tool untuk membaca/menulis workspace, dan command terminal dengan persetujuan.
- **Lampiran AI** — gambar PNG/JPEG/WebP/GIF, PDF, DOCX, XLSX, PPTX, file teks, serta audio/video yang tervalidasi ukurannya dan signature-nya. PDF hasil scan dapat dikirim sebagai dokumen langsung ke model multimodal Google Gemini untuk OCR/layout; input audio/video juga memakai jalur media Gemini. Jalur OpenAI-compatible tetap mengirim gambar atau teks hasil ekstraksi, dan akan menolak media langsung yang tidak didukung agar tidak berpura-pura sudah menganalisisnya. Berkas media langsung maksimal 12 MiB per file dan total media maksimal 14 MiB per pesan.
- **Live research AI** — pencarian web, membaca halaman HTTPS publik, pengecekan versi package registry, dan waktu zona. Tool pembaca halaman tidak menjalankan JavaScript situs; halaman dinamis/anti-bot mungkin tidak dapat dibaca.
- **Website / browser** — pratinjau dev server di tab Website. Navigasi browser dibatasi ke HTTP/HTTPS, dan popup dari halaman tersemat dinonaktifkan.

## Menjalankan (mode pengembangan)

```powershell
npm install
npm run dev        # build + jalankan Electron
```

Perintah lain:

```powershell
npm run typecheck  # cek TypeScript
npm run build      # build main + preload + renderer
npm start          # jalankan hasil build
npm run dist       # buat installer .exe (NSIS) di folder release/
```

## Cara pakai

1. **Host**: buka app → isi nama → pilih folder project → "Buat Ruangan" → catat kode 6 karakter.
2. **Anggota**: buka app di laptop lain (WiFi sama) → masukkan kode → Gabung.
3. Giliran: yang memegang giliran bekerja di IDE-nya; perubahan tersinkron otomatis.
   Selesai → "Lepas Giliran", anggota berikutnya otomatis dapat giliran.
4. **Host** menyalakan dev server dari tab **Server**; semua anggota bisa membuka tab **Website**.

## Catatan jaringan

- Semua laptop harus di jaringan yang sama (WiFi/LAN). Jaringan tamu dengan *client isolation*
  tidak akan bisa saling terhubung.
- Windows Firewall biasanya meminta izin saat pertama dijalankan — izinkan untuk
  **Private network**. Tanpa izin, host tidak akan terdeteksi.
- Kode ruangan dan sinkronisasi file antaranggota berjalan pada jaringan lokal. Jika memakai Agent AI, prompt, ringkasan konteks workspace, dan lampiran yang dipilih dikirim ke provider AI yang dikonfigurasi. Jika memakai live research, query/URL dikirim ke layanan web/registry yang dituju. Periksa provider dan konten sebelum mengirim; jangan lampirkan rahasia atau kredensial.

## Struktur

```
src/
  shared/types.ts     kontrak IPC + tipe data
  preload/index.ts    jembatan contextBridge (window.rk)
  main/               host server, sync, antrian, deteksi IDE/framework, dev server
  renderer/           UI React
scripts/build.mjs     bundler esbuild untuk main + preload
```

Project ini dibangun dengan versi stabil terbaru saat implementasi:
Electron 45, React 19.3, Vite 8, TypeScript 7.
