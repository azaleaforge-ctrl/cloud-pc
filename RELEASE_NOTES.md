# Ruang Kerja v1.0.6

## Agentic Coding AI — timeline kerja dan verifikasi yang lebih andal

### 1. Alur agent dan terminal
- Menghentikan panggilan tool identik yang berulang tanpa kemajuan agar agent tidak terjebak dalam loop no-progress.
- Memperkuat deteksi diagnostik terminal berulang untuk error TypeScript, lint, dan npm, termasuk ketika detail keluaran berubah setelah edit kode.
- Menggabungkan balasan assistant, aktivitas tool, dan hasil terminal ke dalam satu timeline kronologis dengan status berjalan, berhasil, dan gagal yang jelas.
- Kartu terminal mempertahankan output serta metadata proses seperti exit code dan diagnostik sehingga hasil dapat diperiksa sebelum agent menyimpulkan tugas berhasil.

### 2. Pertanyaan terstruktur dengan jawaban Custom
- Menambahkan pilihan **Custom (tulis sendiri)** sebagai opsi eksplisit keempat pada pertanyaan agent.
- Kolom jawaban manual hanya muncul ketika Custom dipilih; jawaban kosong tidak dapat dikirim.
- Navigasi keyboard tetap didukung, dan jawaban perlu dikonfirmasi pengguna sebelum agent melanjutkan.

### 3. Skills yang memahami konteks lanjutan
- Untuk pesan singkat atau referensial seperti “lanjutkan”, pemilihan skill dapat menggunakan hingga tiga giliran pesan pengguna sebelumnya dalam konteks yang dibatasi.
- Permintaan baru yang berdiri sendiri tidak mewarisi maksud tugas sebelumnya yang tidak berkaitan.
- Skill analisis dokumen tidak lagi terpicu hanya karena ada PDF yang tidak terkait di inventaris proyek; permintaan dan file aktif tetap menjadi sinyal utama.

### 4. Verifikasi setelah perubahan kode
- Hasil build/test dikaitkan dengan generasi kode yang ada ketika command dimulai.
- Pemeriksaan yang dimulai sebelum edit source atau konfigurasi berikutnya tidak dianggap memverifikasi kode terbaru hanya karena prosesnya selesai belakangan.
- Verifikasi memerlukan exit code sukses dan kecocokan generasi kode; pemeriksaan untuk Todo maupun hasil akhir juga menjaga batas waktu tugas.
- Menambahkan regression tests untuk hasil pemeriksaan lama, pemeriksaan yang masih berjalan saat kode diubah, exit code gagal/tidak diketahui, dan pemeriksaan baru setelah edit.

### Validasi rilis
- CI Windows menjalankan regression tests Agent Runtime, pemeriksaan TypeScript, dan build aplikasi.
- Workflow rilis membangun installer Windows dan memvalidasi target installer pada `latest.yml` serta file blockmap sebelum GitHub Release dibuat.
- Pengujian otomatis tidak menggantikan smoke test manual installer: uji pilihan Custom, beberapa command terminal dengan status berbeda, pesan lanjutan yang memakai konteks sebelumnya, dan edit kode ketika build/test masih berjalan.

---

# Ruang Kerja v1.0.5

## Agentic Coding AI, Markdown, dan antrian kolaborasi

### 1. Perenderan teks AI yang lebih lengkap
- Memperbaiki daftar bernomor agar urutannya tampil 1, 2, 3, 4, bukan 1, 1, 1, 1.
- Mendukung variasi penanda daftar bernomor, alfabet/romawi, bullet, serta checklist Markdown.
- Memperjelas format teks: heading, **tebal**, *miring*, ~~coret~~, `kode inline`, tautan, kutipan, tabel, garis pemisah, dan blok kode.
- Menampilkan penanda akhir `</think>` secara jelas, bukan sebagai tag mentah yang membingungkan.
- Menambah jarak antarparagraf agar penjelasan error dan solusi lebih mudah dibaca.

### 2. Todo dan perubahan workspace
- Todo dan diff lama dibersihkan saat tugas baru dimulai agar panel menampilkan pekerjaan terbaru.
- Todo disembunyikan setelah run berhasil selesai atau dibatalkan.

### 3. Pertanyaan Agentic AI
- Mempertahankan pertanyaan agent dengan tiga pilihan berdeskripsi dan satu jawaban custom.
- Jawaban tetap harus dikonfirmasi pengguna melalui tombol kirim sebelum agent melanjutkan eksekusi.
- Navigasi keyboard dan fokus pilihan harus diuji pada regresi rilis.

### 4. Status antrian
- Menampilkan anggota berstatus Idle terpisah dari Sedang Bekerja dan Antrean Menunggu.
- Setelah pemegang giliran idle selama dua menit, giliran dilepas dan diteruskan ke anggota antrean berikutnya. Jika tidak ada anggota lain, ruang kembali kosong sehingga giliran baru bisa diambil.

### 5. Detail Version
- Detail Version di dalam aplikasi tetap tersedia.
- Setiap versi harus memiliki deskripsi perubahan/fitur/perbaikan yang spesifik; tampilkan tiga rilis terbaru dan pertahankan riwayat versi lama.
- Tombol Muat Ulang Versi dan fallback/cache tetap dipertahankan saat GitHub API gagal atau terkena rate limit.

### Validasi rilis
- Jalankan typecheck, build, dan test agent runtime pada CI Windows.
- Uji manual: daftar bernomor dan variasi marker, format Markdown, pertanyaan AI dengan mouse/keyboard, konfirmasi sebelum eksekusi, pembersihan Todo/diff, serta alih giliran idle dengan satu dan dua anggota.
- Pastikan artefak `Ruang-Kerja-Setup-1.0.5.exe`, `latest.yml`, dan blockmap tersedia di GitHub Release.

---

# Ruang Kerja v1.0.4

## Agentic Coding AI — stabilitas terminal, kontrol kerja, dan diagnostik yang dapat diperiksa

Ruang Kerja v1.0.4 memusatkan perbaikan pada keandalan alur kerja Agentic Coding AI. Perubahan dibagi menjadi empat tahap: fondasi terminal dan keselamatan eksekusi, tata letak UI agent, diagnostik proses terminal, serta regression checks dan metadata rilis.

### 1. Terminal dan kontrol eksekusi
- Menyamakan konfigurasi shell yang digunakan oleh agent dan runtime terminal.
- Pada Windows, PowerShell diprioritaskan dengan fallback ke CMD bila shell utama tidak tersedia.
- Status keluar proses diteruskan dengan benar agar command sukses dan gagal tidak tertukar.
- Permintaan pembatalan saat sesi sedang diinisialisasi tetap dicatat; Escape dapat membatalkan run saat fokus berada di composer chat.
- Menambahkan guard untuk Todo yang tidak valid dan kegagalan berulang tanpa progres, tanpa menonaktifkan validasi dependensi atau batas keselamatan.

### 2. Tata letak Agentic Coding UI
- Panel kanan untuk Todo dan perubahan workspace ditampilkan berdampingan dengan chat, dengan area scroll independen agar daftar panjang tidak mengharuskan pengguna menggulir seluruh chat.
- Perubahan workspace terbaru ditampilkan lebih dahulu.
- Persetujuan terminal dan status run diposisikan dekat composer, bukan terkubur sebagai pesan lama dalam timeline.
- Status error tetap terlihat sampai pengguna dapat membaca dan menindaklanjutinya.
- Pertanyaan terstruktur AI mendukung pilihan yang disarankan dan input Custom. Alasan rekomendasi ditampilkan terpisah; pilihan tidak dikirim otomatis tanpa keputusan pengguna.

### 3. Riwayat proses terminal dan diagnostik
- Menyimpan hingga 20 proses terminal pada satu run agent, termasuk command, status, waktu mulai/selesai, durasi, timeout, exit code, pesan error, shell, dan direktori kerja.
- Menyimpan stdout dan stderr beserta waktunya dengan batas ukuran dan jumlah event agar penggunaan memori terkendali.
- Riwayat command sebelumnya tetap dapat diperiksa setelah command berikutnya dimulai.
- Tombol **Salin detail diagnostik** menyalin metadata proses serta output yang tersedia untuk memudahkan pelaporan error.
- Regression tests memeriksa batas riwayat/output, pemeliharaan output saat status berubah, metadata diagnostik, dan metadata shell/direktori kerja.

### 4. Validasi dan batasan
- CI menjalankan rangkaian regression test Agent Runtime, pemeriksaan TypeScript, dan build aplikasi pada Windows.
- Tes otomatis tidak membuktikan bahwa setiap model/provider mendukung tool-calling atau bahwa seluruh situs web selalu dapat diakses.
- Sebelum menyatakan rilis tervalidasi penuh, lakukan pengujian manual pada installer Windows: beberapa command berturut-turut, command sukses/gagal/timeout/cancel, salin diagnostik, pilihan rekomendasi + Custom, Escape saat composer fokus, serta layout Todo/perubahan workspace.
- Rilis ini tidak mengklaim seluruh masalah eksternal model, jaringan, atau provider telah dihilangkan.

### Detail Version di dalam aplikasi
**Detail Version tetap tersedia dan wajib menampilkan deskripsi perubahan untuk setiap versi.** Buka versi pada bilah status bawah untuk melihat riwayat rilis. Daftar menampilkan maksimal tiga rilis terbaru yang sudah dipublikasikan: versi terbaru di atas, lalu dua versi sebelumnya. Setiap entri memuat nomor versi, deskripsi perubahan/fitur/perbaikan, dan tautan sumber rilis bila tersedia. Gunakan **Muat Ulang Versi** untuk mengambil data terbaru dari GitHub. Jika API GitHub sedang membatasi permintaan atau gagal, aplikasi menggunakan mekanisme fallback/cache yang tersedia dan menampilkan status yang jelas; jangan mengarang deskripsi untuk versi yang tidak memiliki release notes.

---

# Ruang Kerja v1.0.3

## Perbaikan keandalan Agentic Coding AI

Rilis ini menindaklanjuti kegagalan tool yang terlihat pada v1.0.2, termasuk Todo Orchestrator yang berhenti pada transisi dependensi dan tool web research yang gagal memperoleh atau membaca hasil.

### 1. Todo Orchestrator
- Memperbaiki transisi task dependen: agent dapat menyelesaikan task aktif dengan bukti yang memadai sekaligus mengaktifkan task berikutnya dalam satu pembaruan Todo.
- Validasi dependensi tetap aktif. Task dependen tidak dapat dimulai bila prasyarat masih pending, blocked, atau belum diselesaikan.
- Menambahkan regression test untuk transisi atomik dan bukti completion yang tidak memadai.
- Kegagalan Todo tetap dilaporkan secara eksplisit; perubahan ini tidak menonaktifkan safety guard terhadap loop tanpa kemajuan.

### 2. Web Search dan Web Read
- Web Search kini mencoba DuckDuckGo HTML terlebih dahulu lalu beralih ke Bing HTML ketika penyedia pertama gagal, dibatasi, atau hasilnya tidak dapat diparse.
- Parser fallback hanya menerima tautan HTTPS dan menangani pola redirect Bing yang umum.
- Kegagalan jaringan sementara dan HTTP 429/5xx mendapat satu percobaan ulang terbatas.
- Permintaan web menggunakan User-Agent browser-style dan Accept-Language untuk kompatibilitas yang lebih baik.
- Tool mendeteksi sejumlah halaman anti-bot/security challenge agar tidak memperlakukan halaman penghalang sebagai isi artikel.
- Jika semua penyedia pencarian gagal, tool mengembalikan alasan error yang lebih jelas alih-alih menyatakan pencarian berhasil tanpa hasil.

### Catatan validasi dan batasan
- Regression tests, TypeScript typecheck, dan build aplikasi lulus pada CI GitHub Actions untuk perbaikan Todo dan web research.
- CI memvalidasi parser, alur dan build dengan data uji; CI tidak menjamin semua mesin pencari atau situs tujuan selalu tersedia.
- Akses langsung masih bergantung pada DNS, koneksi internet, rate limit, redirect, dan kebijakan situs. Sebagian situs dapat menolak akses otomatis atau memuat isi secara dinamis.
- Dukungan function/tool-calling tetap bergantung pada model, endpoint, dan provider 9router yang dipilih. Gunakan Pengaturan AI/diagnostik kemampuan model bila agent tidak menjalankan tool.
- Jika error lain tetap muncul, catat nama tool dan pesan error yang tampil. Rilis ini memperbaiki temuan yang telah direproduksi, bukan mengklaim semua kemungkinan kegagalan telah dihilangkan.

---

# Ruang Kerja v1.0.2

## Agentic Coding AI — alur kerja lebih terarah, riset langsung, dan sesi yang dapat dipulihkan

Ruang Kerja v1.0.2 menyatukan peningkatan Agentic Coding AI dari enam tahap implementasi. Agent sekarang mempunyai alur kerja berbasis tugas, terminal yang lebih terukur, dukungan lampiran, riset informasi terkini, diagnostik kemampuan model, serta riwayat sesi dan checkpoint perubahan file.

### Fitur baru dan peningkatan

#### 1. Todo dan orkestrasi pekerjaan AI
- Permintaan coding kompleks dipecah menjadi daftar tugas dengan status, prioritas, dependensi, kriteria verifikasi, dan bukti penyelesaian.
- Panel AI menampilkan progres Todo, aktivitas tool yang sedang berjalan atau telah selesai, serta hasil akhir run.
- Status kerja dibedakan dengan jelas: selesai, terblokir, dibatalkan, atau gagal. Agent tidak boleh menyatakan pekerjaan selesai hanya karena menghasilkan jawaban teks ketika tugas masih belum terpenuhi.
- Mekanisme kelanjutan memakai batas keselamatan untuk panggilan tool, durasi, kegagalan berulang, dan respons tanpa progres.

#### 2. Terminal dan verifikasi build/test
- Output stdout dan stderr ditampilkan secara streaming saat command berjalan.
- Status proses, exit code, durasi, timeout, pembatalan, dan kegagalan disampaikan secara eksplisit.
- Agent diarahkan menjalankan perintah pemeriksaan yang sesuai dengan project setelah perubahan kode, misalnya build, test, lint, atau typecheck, lalu menggunakan hasilnya untuk memperbaiki kegagalan.
- Persetujuan pengguna sebelum command terminal dieksekusi tetap berlaku.

#### 3. Lampiran gambar, dokumen, dan file kode
- Pengguna dapat melampirkan gambar PNG, JPG/JPEG, WebP, dan GIF, serta dokumen PDF, DOCX, XLSX, dan PPTX ke chat AI.
- File teks dan kode umum juga dapat dilampirkan untuk dianalisis bersama permintaan pengguna.
- Pemrosesan dilakukan melalui proses utama aplikasi dan lampiran tidak ditulis ke workspace project.
- Analisis visual bergantung pada dukungan model/router yang dipilih. PDF hasil scan yang tidak memiliki teks tidak menjalani OCR pada versi ini; ekstraksi dokumen Office berfokus pada teks dan nilai sel, bukan mempertahankan seluruh tata letak, grafik, komentar, atau media tertanam.

#### 4. Navigasi Skills dan Plugin
- Menu Extensions pada area editor diganti menjadi **Skills**.
- Katalog **Skills** dan **Plugin** tersedia sebagai bagian terpisah dengan pencarian dan tautan menuju sumber upstream.
- Agent dapat memakai skill bawaan yang sesuai tugas, termasuk analisis dokumen dan lampiran.
- Katalog pihak ketiga berfungsi sebagai direktori referensi; instalasi otomatis skill eksternal dan runtime eksekusi plugin/MCP penuh belum termasuk rilis ini.

#### 5. Riset web dan versi paket
- Agent dapat mencari web, membaca halaman HTTPS publik yang memenuhi pemeriksaan keamanan, dan memeriksa versi paket pada registry npm, PyPI, crates.io, Packagist, serta RubyGems.
- Tool waktu dapat membaca waktu sistem lokal dan zona waktu IANA yang diminta.
- Hasil riset menyertakan sumber atau waktu pengambilan jika tersedia. Konten dari web diperlakukan sebagai data eksternal, bukan instruksi tepercaya.
- Tool memiliki batas ukuran, timeout, serta perlindungan terhadap alamat internal dan URL yang tidak diperbolehkan.

#### 6. Pemilihan model dan diagnostik kemampuan
- Model dapat ditemukan melalui katalog `/models` dari endpoint 9router yang dikelola aplikasi, lalu dipilih dan disimpan untuk permintaan AI berikutnya.
- Pemeriksaan kemampuan mencakup chat completion, function/tool-calling, dan penerimaan input gambar.
- Hasil menunjukkan status dukungan dan waktu pemeriksaan. Dukungan menerima input gambar tidak menjamin kualitas pemahaman visual, dan kemampuan model dapat berubah sesuai provider, endpoint, atau versi model.
- API key tetap dipisahkan dari pilihan model dan diagnostik, serta disimpan menggunakan Electron `safeStorage` bila didukung oleh sistem operasi.

#### 7. Riwayat sesi, memory, dan checkpoint file
- Percakapan disimpan secara lokal dan dapat dipulihkan setelah aplikasi dibuka kembali. Panel riwayat membantu membuka atau menghapus sesi tertentu, sementara **Chat Baru** membuat sesi yang terisolasi.
- Context compaction menambahkan ringkasan percakapan lama ke konteks agent tanpa menghapus transcript yang terlihat di chat.
- Todo dan metadata checkpoint disimpan bersama sesi.
- Perubahan file yang dibuat melalui tool `write_project_file` dapat dicatat sebagai checkpoint dan dipulihkan menggunakan **Rewind** atau diterapkan kembali dengan **Redo**.
- Sebelum menulis file, Rewind/Redo memeriksa workspace dan hash file saat ini. Jika file telah diubah secara manual atau oleh proses lain, operasi ditolak untuk menghindari menimpa perubahan yang tidak cocok.
- Riwayat sesi dan memory disimpan di direktori data lokal aplikasi, bukan di folder project dan bukan disinkronkan ke anggota ruangan lain.

### Catatan dan batasan
- Lampiran yang dipilih untuk pesan tersedia selama sesi proses berjalan, tetapi isi file lampiran tidak disimpan secara permanen bersama riwayat chat. Setelah aplikasi dimulai ulang, lampiran yang diperlukan untuk analisis ulang harus dikirim kembali.
- Checkpoint Rewind/Redo hanya mencakup penulisan yang dilakukan melalui tool `write_project_file`. Perubahan dari terminal, IDE eksternal, anggota kolaborasi lain, atau edit manual tidak otomatis menjadi checkpoint.
- Transcript, ringkasan sesi, dan konten checkpoint disimpan sebagai file lokal JSON/Markdown dan tidak dienkripsi saat tersimpan. API key disimpan terpisah melalui `safeStorage`.
- Penyimpanan sesi bersifat lokal di perangkat, bukan backup cloud. Buat backup project secara terpisah.
- Pemeriksaan otomatis dan build tidak menggantikan pengujian manual pada installer Windows, akun model/router yang digunakan, serta folder project nyata.

### Riwayat versi di dalam aplikasi
Buka versi di bilah status bawah aplikasi untuk melihat **Detail Version**. Aplikasi memuat catatan rilis dari GitHub dan menampilkan maksimal tiga rilis terbaru yang telah dipublikasikan, termasuk versi ini dan dua versi sebelumnya. Gunakan tombol **Muat Ulang Versi** untuk meminta data terbaru.

---

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
