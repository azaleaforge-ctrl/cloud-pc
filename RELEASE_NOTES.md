# Ruang Kerja VFIX 0.3.4

## IDE terintegrasi dan deteksi IDE
- Locator jendela IDE tidak lagi mengandalkan PID launcher saja. Ruang Kerja juga mencari jendela native berdasarkan identitas executable dan judul proyek, karena IDE berbasis Electron sering meneruskan folder ke proses yang sudah berjalan.
- IDE berbasis VS Code yang kompatibel diminta membuka jendela proyek baru sebelum native embedding.
- Deteksi IDE menambahkan jalur instalasi Antigravity yang lebih luas dan pemindaian shortcut Start Menu untuk lokasi instalasi khusus.
- Jika Windows menolak native embedding, aplikasi menampilkan alasan yang lebih spesifik daripada timeout generik.

## Server Laravel dan preview website
- Readiness check menggunakan HTTP GET valid, bukan koneksi TCP yang langsung diputus. Ini menghindari pesan Laravel `Invalid request` yang sebelumnya ditimbulkan oleh probe port.
- Server harus memberi respons HTTP sebelum status Berjalan ditampilkan.
- Preview website menampilkan pesan kegagalan load di dalam Ruang Kerja, serta opsi muat ulang atau buka di browser untuk membantu diagnosis.
- LAN proxy tetap digunakan ketika server localhost-only tidak dapat diakses langsung lewat IP LAN.

## Tampilan workspace dan Detail Version
- Jendela aplikasi otomatis dimaksimalkan ketika mulai dibuka.
- Detail Version dibatasi menjadi 3 rilis terbaru: versi terkini dan dua versi sebelumnya.

## Download alternatif
- Workflow release mendukung mirror Cloudflare R2 opsional jika secrets repository dikonfigurasi.
- Saat mirror tersedia, metadata updater akan mengarahkan installer ke URL publik mirror sementara release tetap disimpan di GitHub.
- Tanpa konfigurasi R2, alur release tetap memakai GitHub seperti biasa.
- Lihat `DOWNLOAD_MIRROR.md` untuk cara mengaktifkan mirror. Kecepatan aktual tetap perlu diuji dari jaringan pengguna.
