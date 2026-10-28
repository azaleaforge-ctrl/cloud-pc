# Ruang Kerja v0.4.8

## AI Coding Agent: workspace access, real file editing, full-size editor, and code diff review

### Agentic coding — bukan chat mengambang
- **Tampilan penuh di editor:** panel AI berubah menjadi workbench penuh dengan tombol Kembali ke Editor. Tersedia area percakapan, status workspace, dan panel konteks proyek.
- **Akses workspace nyata:** agent membaca inventory folder proyek yang sedang aktif sebelum menjawab. Inventory menjelajah folder bertingkat dan mengabaikan dependency/build output yang besar.
- **Konteks file terpilih:** jika sebuah file sedang terbuka di editor, isi file tersebut diteruskan sebagai konteks agent dengan tetap mematuhi batas workspace.
- **Tool usage untuk tugas coding:** permintaan membuat, membaca, mencari, memperbaiki, atau mengubah kode mendorong agent memakai tool workspace, bukan hanya menjawab dengan contoh kode. Jika model tidak memanggil tool, aplikasi menampilkan error yang jelas.
- **Path lebih fleksibel:** tool menerima path relatif atau path absolut selama target tetap berada di dalam folder proyek ruangan aktif.
- **Menulis kode sungguhan:** tool `write_project_file` membuat file baru dan direktori yang dibutuhkan atau menyimpan perubahan pada file yang ada.
- **Diff yang bisa diperiksa:** setiap penulisan mengirim perubahan file ke UI. Detail diff memperlihatkan kode lama dan baru secara berdampingan, nomor baris, serta jumlah baris ditambahkan dan dihapus.
- **Markdown lebih lengkap:** jawaban agent mendukung heading, **bold**, *italic*, coretan, inline code, fenced code blocks, daftar bernomor/tidak bernomor, blockquote, tabel, dan tautan.
- **Terminal tetap aman:** command terminal meminta persetujuan sebelum dieksekusi.
- **Detail Version:** riwayat versi di aplikasi tetap dibatasi pada tiga rilis terbaru, dan deskripsi rilis terbaru tersedia di GitHub.

### Cara menggunakan
1. Pasang versi v0.4.8.
2. Buka ruangan dengan folder proyek yang benar, lalu buka tab **Editor**.
3. Klik **AI Agent** atau tekan `Ctrl+Shift+L`. AI akan mengambil seluruh area editor, bukan tampil sebagai jendela mengambang.
4. Pastikan path workspace di bagian atas sesuai dengan folder project yang dipilih ketika membuat atau bergabung ke ruangan.
5. Masukkan API key 9router yang aktif di pengaturan jika belum tersimpan.
6. Minta agent memeriksa atau mengubah file. Perubahan yang dibuat muncul pada bagian **Perubahan workspace**. Klik **Detail diff** untuk membandingkan versi lama dan versi baru serta memeriksa statistik baris.

> Keamanan: agent hanya boleh membaca dan menulis di dalam folder proyek ruangan aktif; file secret tetap diblokir. Jika tool-calling model tidak didukung oleh endpoint/provider, aplikasi menampilkan kegagalan secara eksplisit alih-alih mengklaim file sudah diubah.

---

# Ruang Kerja v0.4.7

## Perbaikan Detail Version dan deskripsi rilis

### Perbaikan
- **Versi terbaru muncul saat Detail Version dibuka:** aplikasi melakukan refresh ke GitHub setiap kali modal Riwayat Versi & Perubahan dibuka, tidak lagi menampilkan cache lokal hingga satu jam tanpa mencoba data baru.
- **Tombol Muat Ulang Versi:** pengguna dapat meminta ulang daftar versi dan deskripsi langsung dari GitHub, tanpa menunggu cache lokal satu jam.
- **Penanganan jaringan:** kegagalan API GitHub tidak membuat modal terus berada pada status memuat. Aplikasi menampilkan pesan error dan tetap mencoba release feed; cache digunakan sebagai fallback jika sumber online tidak tersedia.
- **Maksimal tiga versi:** Detail Version menampilkan tiga rilis terbaru yang telah dipublikasikan.
- **Deskripsi per rilis lebih bersih:** installer release sekarang mengambil bagian catatan untuk versi tersebut saja, bukan menyalin catatan seluruh versi lama ke deskripsi rilis terbaru.

### Hasil yang diharapkan
- Versi terbaru beserta deskripsinya tampil di urutan pertama.
- Dua versi sebelumnya tampil di bawahnya.
- Gunakan **Muat Ulang Versi** jika baru saja menerbitkan versi baru dan ingin memperbarui daftar.

---

# Ruang Kerja v0.4.6

## Fix AI Agent chat setup and 9router connection

### Perbaikan
- **Perbaikan chat awal:** pengaturan 9router otomatis terbuka jika API key belum dikonfigurasi. Chat dinonaktifkan dengan penjelasan yang jelas sampai konfigurasi tersedia, sehingga permintaan tidak lagi tampak terkirim tanpa jawaban.
- **Uji koneksi model:** pengaturan AI menyediakan tombol untuk menguji permintaan Chat Completions sungguhan ke model `ps/poolside/laguna-s-2.1(high)`, dengan endpoint utama dan cadangan dicoba berurutan.
- **Fallback lebih kuat:** endpoint cadangan tetap dicoba ketika endpoint utama mengembalikan respons HTTP yang gagal, termasuk perbedaan dukungan model atau tool.
- **Perbaikan layout error:** pesan error ditampilkan di area pesan chat, bukan menimpa input. Error otomatis hilang setelah 5 detik.
- **Pengiriman chat lebih aman:** pesan tidak dikirim ketika API key atau workspace belum siap; status konfigurasi tampil secara eksplisit.
- **Notifikasi:** error chat, hasil uji koneksi yang gagal, toast, dan error pembaruan tetap bersifat sementara.

### Setup pertama kali
1. Buka tab **Editor** di dalam ruangan proyek.
2. Panel AI Agent akan membuka pengaturan 9router bila belum dikonfigurasi.
3. Masukkan API key 9router yang aktif, lalu pilih **Simpan & uji**.
4. Pastikan status koneksi berhasil. Setelah itu, kirim pesan uji seperti `Halo, balas OK.`

> Keamanan: API key lama yang pernah terlihat dalam repository publik harus dicabut/dirotasi. Rilis ini tidak menyertakan API key di source atau installer; pengguna harus memasukkan key baru miliknya.

---

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
