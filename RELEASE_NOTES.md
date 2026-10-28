# Ruang Kerja v0.4.5

## AI Coding Agent — agentic workflow, safer 9router setup, and clearer status

### Perubahan utama
- **Agentic coding, bukan chat biasa:** Poolside menggunakan model `ps/poolside/laguna-s-2.1(high)` melalui API 9router yang kompatibel dengan OpenAI.
- **Tool kerja proyek:** agent dapat menelusuri struktur proyek, membaca file, mencari teks, serta membuat atau mengubah file di workspace aktif.
- **Kontrol terminal:** setiap command terminal menampilkan alasan dan menunggu keputusan pengguna. Command yang belum disetujui tidak dijalankan.
- **Streaming yang lebih tangguh:** pembacaan SSE menangani chunk yang terpotong, sesi agent memiliki ID yang benar sejak awal, dan error koneksi lebih jelas.
- **9router fallback:** endpoint utama `https://rbxludp.abc-tunnel.us/v1`; endpoint lokal cadangan `http://localhost:20128/v1`.
- **API key tidak dibundel:** masukkan API key 9router melalui pengaturan pada panel AI. Aplikasi menyimpan key terenkripsi menggunakan penyimpanan aman sistem operasi bila tersedia. Key tidak ditulis ke file project.
- **Status kerja agent:** panel menampilkan aktivitas saat membaca, mencari, mengubah file, atau menunggu izin terminal. Agent bisa dihentikan dari panel.
- **Pesan error dan notifikasi:** toast aplikasi, error chat agent, dan notifikasi error pembaruan otomatis otomatis menghilang setelah 5 detik.
- **Riwayat versi:** Detail Version membatasi daftar pada tiga rilis terbaru: versi sekarang dan dua versi sebelumnya.
- **CLI agent lokal:** pilihan Claude Code, OpenCode, dan KiloCode tetap tercantum; ketersediaannya bergantung pada CLI yang terpasang di perangkat.

### Cara mengaktifkan AI
1. Buka ruangan proyek dan masuk ke tab Editor.
2. Buka panel AI Agent menggunakan tombol bot atau pintasan yang tersedia.
3. Buka pengaturan ⚙, masukkan API key 9router yang masih aktif, lalu pilih **Simpan**.
4. Kirim permintaan coding. Agent membaca konteks proyek dan menggunakan tool saat diperlukan.
5. Tinjau command yang diminta dan pilih **Izinkan sekali** atau **Tolak** sebelum command terminal berjalan.

> Catatan keamanan: jangan gunakan kembali API key yang pernah ditulis di source atau riwayat publik. Cabut key lama dan buat key baru sebelum menggunakan rilis ini.

---

# Ruang Kerja v0.4.3

## AI Agent Chat built-in + 9router Plugin System

### Fitur Baru:
1. **Chat AI Agent built-in** — Panel chat AI langsung di editor, mirip GitHub Copilot di VS Code.
2. **Floating panel** — Panel chat mengapung, bisa di-minimize/maximize.
3. **9router plugin system** — Agent terdaftar sebagai plugin dengan konfigurasi model dan endpoint.

---

# Ruang Kerja v0.4.2

## Terminal VS Code-like (Critical Fix)
- Kursor I-beam hilang di canvas terminal, scroll wheel tidak tersangkut, grid resize sync.
- OpenCode plugin cleanup dokumentasi.
