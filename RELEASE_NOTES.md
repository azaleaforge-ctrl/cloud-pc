# VFIX 0.3.1 - Ruang Kerja

## IDE di dalam Ruang Kerja
- IDE yang dipilih dapat ditanam ke jendela Ruang Kerja pada Windows.
- Tampilan berubah menjadi mode IDE penuh dengan bar kontrol minimal di kiri atas.
- Tombol kembali mengembalikan pengguna ke workspace tanpa membuka jendela IDE terpisah.
- Integrasi berlaku untuk IDE desktop Windows yang berhasil dideteksi Ruang Kerja.

## Sistem antrean berbasis aktivitas
- Status kerja tidak lagi hanya bergantung pada perubahan file.
- Aktivitas IDE, terminal, UI Ruang Kerja, dan proses AI coding agent ikut memperpanjang lease kerja.
- Idle otomatis setelah 2 menit tanpa aktivitas yang terdeteksi.
- Permintaan giliran ditampilkan sebagai bar persisten yang tidak menghalangi pekerjaan.
- Saat pemegang giliran selesai, muncul keputusan Approve / Masih bekerja dengan batas 15 detik.
- Persetujuan otomatis dilakukan setelah 15 detik.
- Penolakan menunda peminta selama 2 menit.
- Jika pemegang giliran kembali aktif, permintaan kembali menjadi bar dan ditanyakan lagi setelah periode tunggu 1 menit.

## Server development dan preview website
- Laravel dijalankan dengan host 0.0.0.0 agar preview LAN dapat diakses anggota lain.
- Django juga listen pada semua interface.
- Environment host publik diperkuat untuk server development umum.
- Status server dan URL preview tetap disebarkan melalui host ke anggota ruangan.

## Deteksi IDE
- Scanner mencoba lokasi instalasi langsung sebelum pencarian folder umum.
- Lokasi Antigravity yang umum ditangani secara eksplisit.
- Jalur instalasi non-standard tidak lagi hanya bergantung pada registry Windows.

## Pembaruan aplikasi
- Versi aplikasi dinaikkan ke 0.3.1 agar dapat menjadi update setelah 0.3.0 yang sudah terbit.
- Detail versi ditampilkan sebagai daftar perubahan fitur, bukan link repository.