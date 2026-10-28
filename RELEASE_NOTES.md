# Ruang Kerja v1.0.1

## Agentic Coding AI — katalog Skill dan Plugin

### Navigasi
- Menu Ekstensi pada navigasi utama diganti menjadi **Skills**.
- Ditambahkan menu **Plugin** terpisah.
- Kedua halaman memiliki pencarian katalog dan tautan ke repositori upstream.

### Katalog sumber terbuka
- Katalog Skills memuat 15 referensi workflow dan panduan coding.
- Katalog Plugin memuat 10 referensi tool/MCP untuk browser, filesystem, Git, GitHub, dokumentasi, dan database.
- Entri katalog membuka sumber GitHub agar pengguna dapat memeriksa lisensi, dokumentasi, dan izin yang diperlukan.

### Batasan implementasi
- Katalog pada versi ini masih berupa direktori referensi. Instalasi satu-klik, validasi manifest, sandbox/izin plugin, dan pemuatan otomatis ke runtime Agentic Coding AI belum tersedia.
- Pengiriman gambar/PDF/DOCX, ekstraksi konten dokumen, serta vision multimodal belum diimplementasikan pada rilis ini.
- Rewind chat dan perubahan file per pesan, pengelolaan sesi seperti perintah `/sessions`, serta menu aksi pesan lengkap masih memerlukan implementasi terpisah.
- Versi Detail di dalam aplikasi tetap dipertahankan.

---


## Agentic Coding AI — local session memory, skills, editor workbench, file icons, and queue-aware execution

### AI session memory
- **Memory tetap lokal:** catatan sesi AI disimpan di direktori data aplikasi Electron, bukan di folder proyek pengguna dan bukan di cloud.
- **Isolasi setiap chat:** percakapan baru membuat memory sesi baru dan menghapus memory sesi sebelumnya. Riwayat chat tidak dipulihkan dari localStorage setelah aplikasi dibuka ulang.
- **Catatan ringkas untuk konteks penting:** coding agent dapat membaca dan memperbarui memory Markdown yang pendek untuk menyimpan keputusan terverifikasi, progres, batasan, dan perubahan yang benar-benar sudah dilakukan.
- **Kontrol rahasia:** memory memiliki batas ukuran dan pemeriksaan pola token/credential umum. Memory bukan backup kode; file asli dan diff tetap menjadi sumber utama untuk mengetahui perubahan.

### 10 built-in coding skills
- **Pemilihan sesuai tugas:** Lazy Dev, Context Engineering, Debugging & Error Recovery, Security & Hardening, Test-Driven Development, Safe Code Changes & Versioning, No AI Slop UI, UI/UX Pro Max, Frontend UI Engineering, dan Backend Development.
- **Pemuatan seperlunya:** konteks proyek dibatasi dan instruksi skill terpilih dimuat berdasarkan tugas, alih-alih memasukkan semua instruksi skill pada setiap permintaan.
- **Penanda skill aktif:** UI menampilkan skill yang dipilih untuk tugas saat ini.
- **Penyimpanan lokal:** katalog skill berada di direktori data aplikasi dan tidak mencampuri source code proyek.
- **Catatan sumber:** skill bawaan Ruang Kerja merupakan instruksi terkurasi yang merujuk ke proyek skill open-source terkait; bukan salinan verbatim seluruh repositori upstream.

### Editor dan Agentic Coding Chat
- **Chat tetap di area editor:** AI Coding Agent ditampilkan sebagai tab di dalam workbench, sementara Activity Bar, Explorer, dan Status Bar tetap tersedia. Chat tidak lagi menggantikan seluruh halaman editor.
- **Ruang percakapan lebih lebar:** bubble pesan pengguna dan area composer diberi batas lebar yang lebih besar agar pesan panjang tidak terpotong menjadi banyak baris terlalu cepat.
- **Akses kontrol tetap tersedia:** tombol pengaturan AI, hentikan agent, dan Chat baru tetap dapat diakses dari toolbar.
- **Efisiensi konteks:** inventory proyek serta cuplikan file aktif dibatasi, dan hanya beberapa pesan terakhir yang diteruskan sebagai riwayat kerja.

### Ikon file
- **Penanda berdasarkan tipe file:** Explorer, tab editor, dan daftar file proyek menampilkan glyph berwarna sesuai ekstensi, termasuk HTML, CSS, JavaScript, TypeScript, JSON, Markdown, PHP, Python, SQL, YAML, gambar, serta tipe umum lainnya.
- **Nama khusus dikenali:** Dockerfile, README, LICENSE, berkas .env, dan berkas lock mendapat penanda khusus.

### Antrian kerja dan AI Agent
- **Status AI aktif dipublikasikan ke ruang:** host dan anggota menerima status bahwa AI Coding Agent sedang mengerjakan tugas atas nama pemegang giliran.
- **Timer idle ditangguhkan selama agent bekerja:** giliran tidak dilepas otomatis hanya karena agent belum menyentuh berkas selama dua menit.
- **Giliran tidak dilepas saat agent aktif:** pelepasan manual dan keputusan antrian diblokir sampai agent dihentikan atau selesai.
- **Antrian dilanjutkan setelah selesai:** ketika agent selesai, sistem kembali menjalankan mekanisme idle dan meminta keputusan antrian; auto-approve 15 detik tetap berlaku setelah prompt keputusan aktif.
- **Status terlihat di UI antrian:** pemegang giliran ditandai sebagai AI Coding ketika agent berjalan.

### Detail Version
- **Panel Detail Version tetap tersedia.** Rilis ini mempertahankan komponen riwayat versi dalam aplikasi dan sumber catatan rilis yang digunakan untuk menampilkan tiga versi terbaru.
- Catatan rilis v1.0.0 menjadi sumber detail versi terbaru setelah rilis dipublikasikan.

---

# Ruang Kerja v0.4.9

## Penyempurnaan Markdown di AI Coding Agent

- **Pembatas triple slash (`///`) kini dirender sebagai garis pemisah**, bersama aturan horizontal Markdown standar (`---`, `***`, dan `___`).
- **Pemformatan rich text tetap aktif** untuk `**bold**`, *italic*, coretan, kode inline, blok kode, daftar bernomor dan bullet, blockquote, tabel, tautan, serta heading.
- **AI Agent tetap tampil penuh di editor** dengan akses workspace, pembuatan dan penyuntingan file, serta diff lama/baru yang menunjukkan nomor baris dan statistik penambahan/penghapusan.
- **Detail Version** tetap mengambil rilis terbaru dan menampilkan maksimal tiga versi beserta catatan perubahannya.

---

# Ruang Kerja v0.4.8

## AI Coding Agent: workspace access, real file editing, full-size editor, and code diff review

### Agentic coding — bukan chat mengambang
- **Tampilan penuh di editor:** panel AI berubah menjadi workbench penuh dengan tombol Kembali ke Editor. Tersedia area percakapan, status workspace, dan panel konteks proyek.
- **Akses workspace nyata:** agent membaca inventory folder proyek yang sedang aktif sebelum menjawab. Inventory menjelajah folder bertingkat dan mengabaikan dependency/build output yang besar.
- **Konteks file terpilih:** jika sebuah file sedang terbuka di editor, isi file tersebut diteruskan sebagai konteks agent dengan tetap mematuhi batas workspace.
- **Sesi agent tersambung ke editor aktif:** renderer meneruskan path file aktif lewat IPC ke proses utama; agent memvalidasi path tersebut terhadap root project ruangan sebelum membacanya.
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
