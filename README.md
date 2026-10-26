# Ruang Kerja

App desktop untuk kerja bareng di **satu folder project** lewat WiFi/LAN — tanpa internet.
Satu orang jadi **host**, anggota lain **join** pakai kode ruangan. Hanya satu orang yang
bekerja pada satu waktu (antrian giliran), jadi file tidak pernah bentrok.

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
- Tidak ada data yang keluar ke internet; kode ruangan hanya disiarkan lewat UDP di LAN.

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
