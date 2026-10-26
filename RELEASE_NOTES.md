# Ruang Kerja VFIX 0.3.5

## Perbaikan Detail Version
- Riwayat rilis di-cache secara lokal selama 6 jam sehingga membuka Detail Version tidak meminta GitHub REST API setiap kali.
- Saat API GitHub memberi 403/429 atau gagal diakses, aplikasi mencoba GitHub Releases Atom feed.
- Jika API dan feed gagal sementara, aplikasi menampilkan tiga catatan rilis terakhir dari cache yang tersedia.
- Detail Version hanya menampilkan tiga rilis terbaru.

## Perbaikan IDE
- Katalog IDE diperluas dengan banyak pilihan umum: Visual Studio Code, VSCodium, Antigravity, Cursor, Windsurf, Trae, Zed, Sublime Text, IDE JetBrains, Android Studio, Visual Studio, Eclipse, NetBeans, Qt Creator, Code::Blocks, Geany, JupyterLab, RStudio, Arduino IDE, dan lainnya.
- IDE yang terdeteksi di laptop ditandai Terpasang; entri katalog yang belum ada tetap ditampilkan dengan tautan download resmi bila tersedia.
- Pemindaian diperluas melalui registry Windows, jalur instalasi umum, PATH, shortcut Start Menu, serta beberapa lokasi khusus Antigravity.
- Percobaan native embedding kini memeriksa jendela dengan identitas executable dan nama folder proyek, menghapus gaya titlebar/popup, mengukur area client host dan DPI, serta memverifikasi parent window sesudah dipasang.
- Membuka aplikasi Ruang Kerja untuk kedua kalinya akan mengaktifkan jendela pertama daripada membuat instance tambahan.

## Server development dan preview
- Framework umum memakai script proyek yang terdeteksi bila tersedia; fallback command tidak lagi selalu mengasumsikan script bernama dev.
- Deteksi mencakup lebih banyak tipe proyek termasuk FastAPI, Flask, Rails, Symfony, dan .NET selain Laravel, Django, Go, Rust, PHP, serta framework JavaScript.
- Pemeriksaan readiness dilakukan melalui HTTP request yang valid dan percobaan ulang lebih awal, bukan koneksi TCP kosong.
- Kegagalan perintah umum seperti port sedang dipakai, dependency/command tidak tersedia, atau production build belum dibuat dilaporkan lewat status server/log.
- Server lokal yang membutuhkan LAN proxy meneruskan host/proxy metadata dan mencoba menulis ulang redirect lokal; UI menampilkan port framework dan port proxy bila keduanya berbeda.
- Tab Website memberi pesan error dan opsi reload / buka di browser eksternal ketika gagal dimuat.

## File browser
- Folder dan file sama-sama menampilkan waktu modifikasi berisi tanggal dan jam lokal.
- Metadata filesystem menggunakan timestamp milidetik dengan konversi ISO yang benar.

## Jendela aplikasi
- Jendela Ruang Kerja dimaksimalkan saat aplikasi siap ditampilkan.

## Catatan kompatibilitas
- Katalog IDE dan deteksi instalasi luas, tetapi embedding native bergantung pada struktur window/proses setiap IDE. Beberapa IDE tertentu mungkin tetap memerlukan penanganan khusus; build CI tidak dapat menggantikan tes runtime IDE dan framework pada Windows pengguna.
- Mirror download Cloudflare R2 bersifat opsional dan baru aktif setelah bucket publik serta GitHub Actions secrets dikonfigurasi. GitHub tetap menjadi tempat rilis resmi.
