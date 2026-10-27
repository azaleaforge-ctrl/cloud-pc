# Ruang Kerja v0.3.9

## Perbaikan Editor & Panel
- **Editor background**: Editor tetap hidup (mounted) saat pindah tab; terminal, breakpoint, dan state Monaco tidak reset. Masuk tab Editor = full size.
- **Panel resize (terminal/masalah/output)**: Tarik **naik = expand**, **turun = collapse** (seperti VS Code). Double-click resizer = toggle panel. Min height 60px, max 85% viewport.

## Ekstensi Editor (tab baru: **Ekstensi**)
- Ganti tab **IDE Eksternal** → **Ekstensi**.
- Cari & pasang dari Open VSX (publisher.nama). Ekstensi terpasang masuk ke `manifest.json`, tema & snippet aktif otomatis di Monaco.
- Daftar terpasang: lihat versi, tema, snippet, kontribusi belum didukung. Tombol **Hapus** untuk uninstall.

## Sistem Antrian (Queue) — Manual & AI sama
- **AI agent** (`ide`, `agent`) + **Manual coding** (`file`, `terminal`, `ui`) sekarang **satu antrian**.
- **Manual coding idle 1 menit** → warning notifikasi 45 detik → auto-release. AI agent tetap 2 menit.
- Holder keluar/disconnect → next in queue auto-assign.

## Website Tab — URL bisa diubah
- Toolbar: **klik URL** → edit manual, **Enter** → buka. Bukan read-only lagi.
- Auto-sync dari `server.url` saat server start, tapi user bisa override.

## Laravel Server — Lebih Stabil
- Probe HTTP attempts: **8 → 20**, delay **500ms → 1s** untuk PHP/Laravel/Symfony.
- Fatal patterns tambahan: `PHP Fatal error`, `Could not open input file: artisan`, `No application encryption key`, dsb.
- PATH diwariskan eksplisit ke child process; error exit code dikirim ke UI.

## Update Behavior — Manual, Bukan Otomatis
- `autoDownload = false`. Saat update tersedia: tombol kuning **"Update Tersedia"** di footer & notifikasi.
- Klik **Update** → `downloadUpdate()` → progress bar → selesai → tombol **"Pasang & Mulai Ulang"**.
- "Cek Pembaruan" di modal versi hanya cek, **tidak** download otomatis.
- Error state: tombol **"Coba Lagi"**.

## Tutup Aplikasi — Benar-Benar Keluar
- Klik X / Alt+F4 → **hide to tray** (seperti biasa).
- Klik kanan tray → **Keluar** → `isQuitting = true` → `shutdownRoom()` → `app.quit()` (proses benar-benar mati, tidak nyangkut di background).

---

# Ruang Kerja VFIX 0.3.7

## Server project benar-benar bisa dijalankan
- Perintah dev server disusun ulang per framework: Next.js, Vite, Nuxt, Astro, CRA, Remix, SvelteKit, dan Laravel (`php artisan serve`) memakai binari lokal `node_modules/.bin/<bin>` bila tersedia.
- Fallback `npm run <script>` sekarang memakai bentuk yang benar (`npm run dev -- --host … --port …`); sebelumnya `---host` menyebabkan `npm error EUNKNOWNCONFIG`.
- Argumen host/port hanya dikirim ke framework yang memang menerimanya, jadi script kustom tidak lagi rusak karena flag asing.
- Port dipilih otomatis kalau port bawaan sedang dipakai (mis. 3000 terpakai → 3001), dan URL yang dibagikan mengikuti port hasil pilihan.
- Pemeriksaan awal (`serverDoctor`) memberi pesan Indonesia yang jelas saat `node_modules` belum terpasang, runtime hilang, atau file entry tidak ditemukan — tanpa menjalankan proses yang pasti gagal.
- Watchdog 90 detik dan daftar pola fatal mengubah status ke `error` bila proses langsung mati atau tidak pernah siap; status tidak lagi tertahan di `starting`.
- Start/stop kini idempoten: menghentikan server dua kali tidak error, dan proses ikut dibersihkan saat keluar ruangan atau menutup aplikasi.

## Editor bawaan (tanpa IDE eksternal)
- Tab baru **Editor**: Monaco + terminal xterm dengan shell asli (PowerShell/ConPTY), jadi tidak perlu lagi membuka VS Code di laptop.
- Explorer, pencarian berkas (regex, case-sensitive, whole word), tab multi-berkas, breadcrumb, indikator berkas belum tersimpan, simpan dengan Ctrl+S.
- Panel bawah: Terminal, Masalah (dari marker Monaco), Output, dan Debug Console. Tab Terminal langsung membuka satu shell; terminal tambahan bisa dibuka dari tombol `+`.
- Debugger Node lewat Chrome DevTools Protocol: breakpoint F9, jeda, dan evaluasi ekspresi.
- Peramban ekstensi Open VSX: cari, unduh, dan aktifkan. Tema warna dan snippet berjalan; ekstensi yang butuh Node extension host dilaporkan sebagai belum didukung.
- Layout editor mengisi seluruh area kerja (dulu menyusut jadi sekitar sepertiga lebar karena aturan flex).
- Tab lama yang berisi daftar IDE terdeteksi diganti nama menjadi **IDE Eksternal** agar tidak tertukar dengan Editor bawaan.

## Perbaikan lain
- Pemeriksaan update dilewati bila paket tidak punya `app-update.yml` (build `--dir`/portabel), sehingga tidak lagi menampilkan status error palsu.
- Nomor versi kini dibaca dari `package.json` saat build, jadi rilis dari tag `v*` menampilkan versi yang sama dengan metadata updater.

## Catatan pengujian
- `npm run typecheck` dan `npm run build` bersih.
- Uji dev server: 29 pemeriksaan lulus (start, port bentrok, gagal cepat, watchdog, preflight, stop).
- Uji end-to-end aplikasi: editor mengisi area kerja (1014 px), Monaco merender berkas nyata, terminal menjalankan PowerShell, start/stop server, dan langganan Open VSX berjalan.
- Build paket (`electron-builder --dir`) diuji ulang: Monaco, terminal native, dan prompt shell tetap berjalan.