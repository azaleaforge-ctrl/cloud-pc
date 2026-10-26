# Ruang Kerja VFIX 0.3.2

## Perbaikan auto-update (utama)
- Menetapkan nama installer Windows secara eksplisit menjadi `Ruang-Kerja-Setup-0.3.2.exe`, konsisten dengan URL yang dipakai metadata `latest.yml`.
- Menyamakan nama file installer dan blockmap agar GitHub Release tidak menerbitkan nama yang berbeda dari metadata updater.
- Workflow Release memvalidasi bahwa file yang disebut `latest.yml` benar-benar ada di folder hasil build. Proses release akan gagal lebih awal jika nama tidak cocok, alih-alih menerbitkan update yang berakhir 404.
- Versi aplikasi dan lockfile dinaikkan ke 0.3.2 karena release 0.3.1 sudah dipublikasikan dengan metadata nama file yang tidak cocok.

## IDE di dalam Ruang Kerja
- IDE desktop Windows yang terdeteksi dapat dibuka dalam mode jendela Ruang Kerja dengan toolbar untuk kembali ke workspace.
- Integrasi native window embedding bersifat Windows-specific dan perlu diuji terhadap tiap IDE.

## Sistem antrean berbasis aktivitas
- Aktivitas IDE embedded, terminal, UI Ruang Kerja, dan proses AI coding agent dipakai sebagai sinyal aktivitas.
- Lease kerja idle setelah 2 menit tanpa aktivitas terdeteksi.
- Permintaan giliran ditampilkan sebagai bar persisten.
- Saat pemegang giliran menyelesaikan pekerjaan, prompt Approve / Masih bekerja memiliki countdown 15 detik; jika tidak dijawab, persetujuan otomatis.
- Penundaan menempatkan peminta kembali ke antrean setelah 2 menit; jika pemegang giliran kembali aktif, prompt ditahan dan ditanyakan lagi setelah 1 menit.

## Server development dan preview
- Laravel dan Django diarahkan untuk menerima koneksi LAN.
- Server localhost-only mendapat fallback proxy LAN.
- Framework JavaScript umum meneruskan opsi host/port LAN bila didukung CLI.

## Deteksi IDE
- Menambahkan pencarian langsung pada beberapa lokasi instalasi Windows yang umum, termasuk Antigravity.
