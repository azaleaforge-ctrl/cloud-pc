# Ruang Kerja VFIX 0.3.5

## Perbaikan Detail Version
- Cache riwayat rilis lokal selama 6 jam sehingga membuka Detail Version berulang kali tidak mengirim permintaan ke API GitHub setiap saat.
- Jika GitHub REST API membalas 403/429 atau gagal diakses, aplikasi mencoba feed publik GitHub Releases Atom sebagai fallback.
- Jika API dan feed sementara tidak dapat diakses, aplikasi menampilkan tiga catatan rilis terakhir yang tersimpan di cache, jika tersedia.
- Daftar Detail Version tetap dibatasi ke tiga rilis terbaru.

## Stabilitas
- Pesan error riwayat versi lebih informatif ketika sumber GitHub tidak dapat diakses.
- Fitur cache tidak menghapus release GitHub, installer, ataupun file proyek pengguna.

## Catatan
- GitHub API publik membatasi permintaan tanpa autentikasi per alamat IP. Cache dan Atom fallback mengurangi ketergantungan pada API REST yang sama.
- Pembaruan ini memperbaiki pemuatan riwayat versi; mekanisme unduhan installer tetap menggunakan konfigurasi updater yang sudah ada.
