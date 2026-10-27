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
