# Ruang Kerja VFIX 0.3.3

## Perbaikan pengalaman auto-update
- Mengganti notifikasi unduhan berulang dengan satu panel update persisten yang tidak bisa di-dismiss selama proses berjalan.
- Panel menampilkan progress bar, persentase, byte terunduh/total, kecepatan unduh aktual, dan perkiraan sisa waktu bila tersedia.
- Indikator di footer menggunakan data progress dan kecepatan yang sama dengan panel update.
- Event progress dipublikasikan maksimal sekitar 4 kali per detik agar tidak membebani renderer dan tidak menghasilkan tumpukan toast.
- Status update tidak direset ketika pengguna keluar dari ruangan.

## Perbaikan stabilitas downloader
- Check update diserialisasi agar pemeriksaan startup, menu, dan tombol manual tidak saling menumpuk.
- Tombol pasang tidak memulai download kedua ketika auto-download sedang berjalan.
- NSIS differential download tetap diaktifkan; metadata blockmap dari release sebelumnya digunakan untuk membantu mengunduh bagian yang berubah apabila nama dan versi artefak kompatibel.
- Workflow release memvalidasi kecocokan nama installer dan blockmap sebelum mengunggah release.

## Riwayat versi otomatis
- Setelah tiga perpindahan versi berhasil dijalankan, Detail Version menyembunyikan tiga entri rilis tertua dari daftar lokal.
- Riwayat di GitHub dan file pengguna tidak dihapus; yang dibersihkan hanya entri yang ditampilkan di aplikasi.
- Versi terakhir yang berhasil dijalankan dan hitungan pembersihan disimpan di settings lokal.

## Catatan
- Peningkatan kecepatan melalui differential download bergantung pada ketersediaan blockmap versi sebelumnya. Migrasi dari versi sangat lama yang memakai nama artefak berbeda masih dapat memerlukan unduhan installer penuh satu kali.
- Kecepatan jaringan aktual tetap bergantung pada rute/CDN GitHub; panel sekarang memperlihatkan kecepatan riil agar bottleneck bisa dibedakan dari masalah UI.
