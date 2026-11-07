# Ruang Kerja v1.2.3

## Billing OpenRouter dalam Rupiah — saldo akun, penggunaan, dan kurs USD/IDR

### 1. Saldo akun OpenRouter
- Menambahkan pembacaan total kredit dibeli, total penggunaan akun, dan saldo tersisa melalui endpoint OpenRouter `/api/v1/credits`.
- Saldo akun dibedakan dari limit serta penggunaan API key inferensi aktif; keduanya tidak lagi disamakan.
- Pembacaan saldo membutuhkan Management API Key terpisah. Key bersifat opsional, hanya dipakai untuk membaca endpoint credits, dan tidak dipakai untuk request model.
- Management API Key diverifikasi sebelum disimpan, dienkripsi melalui Electron safeStorage, tidak dikirim ke renderer sebagai teks, dan dapat diganti atau dihapus dari pengaturan.
- Logout OpenRouter juga menghapus Management API Key lokal. Logout tidak mencabut key di dashboard OpenRouter.

### 2. Tampilan biaya dalam Rupiah
- Mengubah tampilan saldo akun, total kredit, penggunaan akun, penggunaan API key, budget key, dan biaya aktual yang dilaporkan untuk request Ruang Kerja menjadi Rupiah (IDR).
- Mengubah harga model per satu juta token, biaya request, image, cache, dan reasoning di katalog model menjadi Rupiah.
- OpenRouter tetap menyimpan saldo dan membebankan penggunaan dalam USD. Konversi di Ruang Kerja hanya untuk tampilan; nilai sumber dan request billing tidak diubah.
- Token, request, limit token, dan limit request tetap menggunakan satuan asli provider.

### 3. Kurs USD/IDR
- Mengambil kurs referensi USD/IDR dari Frankfurter API dan menampilkan tanggal kurs yang digunakan.
- Kurs di-cache di proses aplikasi selama 12 jam untuk mengurangi request berulang; pengguna dapat memperbaruinya secara manual.
- Saat API kurs tidak tersedia, Ruang Kerja tidak mengarang nilai konversi dan menandai nilai Rupiah sebagai belum tersedia.
- Semua nominal pada panel billing menggunakan kurs referensi yang sama sehingga saldo akun, key, dan biaya aplikasi dapat dibandingkan.

### 4. Pemisahan cakupan billing
- **Saldo akun OpenRouter** berasal dari total kredit dibeli dikurangi total penggunaan akun pada endpoint credits.
- **Penggunaan API key** berasal dari endpoint current-key dan hanya menggambarkan key inferensi aktif.
- **Pengeluaran Ruang Kerja** adalah biaya aktual request yang dilaporkan provider dan disimpan lokal pada profil aplikasi; ini bukan total seluruh penggunaan akun.
- Data yang tidak disediakan API ditampilkan sebagai tidak tersedia. Aplikasi tidak mengestimasi biaya berdasarkan jumlah token.

### Detail Version di dalam aplikasi
Buka nomor versi pada bilah status bawah untuk melihat deskripsi perubahan/fitur/perbaikan v1.2.3. Riwayat menampilkan maksimal tiga rilis terbaru beserta deskripsi masing-masing versi. Gunakan tombol Muat Ulang Versi untuk memperbarui daftar dan deskripsi dari GitHub.

---

# Ruang Kerja v1.2.2

## Agentic Coding — provider-first model picker, model pricing details, and live usage dashboard

### 1. Pemilihan provider sebelum model
- Mengubah perintah `/model` menjadi dua tahap: pilih provider terlebih dahulu, kemudian pilih model yang berasal hanya dari provider tersebut.
- Katalog OpenRouter, Groq, Gemini, dan 9Router tidak lagi digabung ke dalam satu daftar model.
- Pilihan model disimpan secara terpisah untuk masing-masing provider. Mengganti provider tidak menghapus model yang terakhir dipilih pada provider lain.
- Tombol Gunakan provider & model mengaktifkan provider yang dipilih sekaligus menyimpan modelnya sebagai konfigurasi aktif Agentic Coding.
- Diagnostik kemampuan dapat dijalankan untuk model yang sedang dipilih pada provider terkait, bukan hanya model global yang sebelumnya aktif.

### 2. Harga dan detail model
- Menampilkan harga input dan output per satu juta token langsung pada katalog apabila metadata harga disediakan oleh provider.
- Menambahkan detail per model, termasuk deskripsi, context window, maksimum output token, modalitas input/output, parameter yang didukung, API/generation methods, serta dukungan tool yang tercantum pada katalog.
- Menampilkan komponen harga tambahan bila tersedia: request, image, cache read, cache write, dan internal reasoning.
- Menampilkan metadata tanggal pembuatan, masa berlaku, dan batas per-request ketika provider menyediakannya.
- Informasi yang tidak dikirim oleh katalog ditandai sebagai tidak tersedia. Label Free Plan tidak otomatis dianggap sebagai harga token nol atau jaminan kuota tanpa batas.

### 3. /connect menjadi modal
- Mengubah tampilan `/connect` dari panel yang muncul di alur isi chat menjadi modal terpusat dengan backdrop.
- Menambahkan tombol tutup, penutupan melalui klik backdrop, dan dukungan tombol Escape.
- Menyamakan pola interaksi visual dengan modal `/sessions` dan `/model`, serta menjaga area pengaturan tetap dapat di-scroll pada layar kecil.

### 4. Panel kanan — Billing & penggunaan
- Menambahkan panel Billing & penggunaan yang menunjukkan provider dan model aktif, akumulasi token input/output/total, serta jumlah request yang usage-nya dilaporkan selama penggunaan Ruang Kerja.
- Menyimpan ringkasan usage lokal agar statistik penggunaan aplikasi tetap tersedia setelah tampilan diperbarui atau aplikasi dibuka kembali.
- OpenRouter menampilkan total usage API key, penggunaan harian/bulanan, limit dan sisa budget API key, serta effective budget bila endpoint mengembalikan data tersebut.
- Stream OpenRouter meminta usage accounting; Groq meminta usage pada stream dan membaca header rate-limit; Gemini meneruskan token count dari `usageMetadata`.
- Menampilkan biaya request hanya ketika provider benar-benar melaporkan nilai biaya aktual. Aplikasi tidak mengarang estimasi billing atau menyamakan token dengan jumlah uang.

### 5. Indikator kuota Free Tier dan Paid
- Menambahkan meter sisa kuota dengan warna hijau untuk 80–100%, kuning untuk 50–79%, oranye untuk 10–49%, dan merah untuk 0–9%.
- Meter menampilkan sisa dibanding limit dan informasi reset ketika response provider menyediakan limit, remaining, dan reset.
- Groq menampilkan kuota token/request dari response rate-limit headers, termasuk detail retry/reset pada HTTP 429.
- OpenRouter menampilkan budget dan penggunaan dari API key yang terhubung; status Free Tier ditampilkan jika metadata akun menyediakannya.
- Gemini menampilkan jumlah token aktual per request. API standar Gemini tidak memberikan remaining quota live pada setiap respons, sehingga meter tidak dibuat dari angka perkiraan; panel mengarahkan pemeriksaan kuota ke Google AI Studio.
- 9Router Local Only tidak menampilkan billing provider eksternal karena request berlangsung melalui endpoint lokal.

### 6. Batasan akurasi dan keamanan data
- Angka akumulasi token di panel adalah usage yang dilaporkan kepada Ruang Kerja pada perangkat ini, bukan total semua aplikasi atau seluruh API key di akun provider.
- Data billing OpenRouter pada endpoint current-key merupakan data API key aktif; saldo kredit total akun tidak disimpulkan dari limit API key standar.
- Kuota dan waktu reset hanya ditampilkan ketika provider mengirim informasi yang dapat diverifikasi. Data yang tidak tersedia dinyatakan secara eksplisit.
- API key tetap ditangani melalui jalur konfigurasi provider yang ada dan tidak ditampilkan sebagai teks terbuka di katalog atau panel billing.

### Detail Version di dalam aplikasi
Buka nomor versi pada bilah status bawah untuk melihat deskripsi perubahan/fitur/perbaikan v1.2.2. Riwayat menampilkan maksimal tiga rilis terbaru beserta deskripsi masing-masing versi. Gunakan tombol Muat Ulang Versi untuk memperbarui daftar dan deskripsi dari GitHub.

---

# Ruang Kerja v1.2.1

## OpenRouter account login, API key visibility, and limit diagnostics

### 1. Login akun OpenRouter — dua langkah
- Menambahkan login akun OpenRouter melalui browser resmi menggunakan OAuth PKCE (S256) dengan callback lokal loopback `127.0.0.1`; password OpenRouter tidak pernah dimasukkan ke Ruang Kerja.
- Setelah persetujuan, authorization code ditukar menjadi user-controlled API key khusus Ruang Kerja. API key disimpan terenkripsi melalui Electron safeStorage.
- Menampilkan User ID OpenRouter yang dikembalikan oleh OAuth atau metadata current-key, sehingga pengguna dapat memastikan akun mana yang terhubung. Endpoint current-key yang dipakai aplikasi tidak memberikan email akun.
- Login akun lain mengganti key aktif lokal untuk OpenRouter; provider lain dan model pilihannya tetap tersimpan terpisah.

### 2. API key dan pemantauan akun
- Menambahkan panel API key yang menampilkan label key, jenis tier bila tersedia, limit key, sisa limit, total penggunaan, penggunaan harian, reset limit, dan effective budget bila API mengembalikannya.
- Menambahkan tautan langsung ke halaman detail API key dan halaman aktivitas OpenRouter berdasarkan SHA-256 key hash; nilai API key lengkap tidak pernah ditampilkan.
- Mempertahankan opsi memasukkan API key OpenRouter yang sudah ada secara manual sebagai alternatif login OAuth.
- Menambahkan tombol **Logout** yang menghapus API key dan metadata akun dari perangkat ini. Logout lokal tidak mencabut key di akun OpenRouter; key harus dicabut dari dashboard OpenRouter bila tidak ingin tetap aktif.

### 3. Diagnosis limit yang lebih jelas
- HTTP 402 kini membedakan `openrouter_key_limit`, `openrouter_credits`, dan `openrouter_in_flight_budget` berdasarkan `error.metadata.limit_source`.
- HTTP 429 kini menampilkan `Retry-After` serta header `X-RateLimit` yang tersedia.
- Catatan penting: rate limit/capacity OpenRouter dikelola secara global. Membuat akun atau API key tambahan tidak meningkatkan kapasitas rate limit global. Saat terkena 429, gunakan model lain yang memiliki kapasitas berbeda atau tunggu waktu retry.
- HTTP 401, 403, 402, dan 429 dibedakan agar kesalahan autentikasi, kebijakan akses, kredit/budget, dan kapasitas tidak tercampur.

### 4. Keamanan dan regresi
- Menambahkan pengujian PKCE verifier/challenge, URL authorization, parsing current-key metadata, identitas akun, key-limit/credit/in-flight-budget, dan Retry-After.
- API key tetap disimpan terenkripsi per-user; OAuth verifier, authorization code, dan API key tidak dikirim ke renderer.
- Callback OAuth menerima koneksi hanya melalui loopback lokal, memvalidasi state, dan kedaluwarsa setelah lima menit.
- Provider Groq, Gemini, 9Router Local Only, model picker, dan Agent Engine tetap dipertahankan.

### Detail Version di dalam aplikasi
Buka nomor versi pada bilah status bawah untuk melihat **deskripsi perubahan/fitur/perbaikan** v1.2.1. Riwayat menampilkan **maksimal tiga rilis terbaru**. Gunakan tombol **Muat Ulang Versi** untuk memperbarui daftar dan deskripsi dari GitHub.

---

# Ruang Kerja v1.2.0

## Agentic Coding AI — provider Groq Free Tier

### 1. Provider baru: Groq
- Menambahkan Groq sebagai provider AI tersendiri menggunakan endpoint resmi `https://api.groq.com/openai/v1`.
- API key Groq dapat disimpan terpisah dan terenkripsi melalui Electron safeStorage, dengan environment variable opsional `GROQ_API_KEY`.
- Groq menggunakan protokol OpenAI-compatible yang sama untuk Chat Completions, streaming SSE, Bearer authentication, dan function/tool calling.
- Groq tidak menggantikan OpenRouter, Gemini, maupun 9Router Local. Pengguna memilih provider secara eksplisit; tidak ada automatic fallback antar-provider.
- Dokumentasi dan halaman API key resmi tersedia dari pengaturan provider.

### 2. Prioritas model gratis
- Katalog Groq dibatasi ke model yang tercantum pada tabel rate limits Free Plan resmi: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, dan `qwen/qwen3.8-27b`.
- Model default Groq adalah `qwen/qwen3.8-27b`, yang mendukung tool use. Dokumentasi Groq saat ini tidak mencantumkan parallel tool use untuk model ini; Agent Runtime tetap memproses tool calls yang diterima secara berurutan.
- Model di luar allowlist Free Plan, model audio, dan model yang tidak aktif tidak ditampilkan di picker Groq.
- Badge **Free Plan** menunjukkan kelayakan model pada tier gratis Groq, bukan klaim bahwa metadata harga token provider bernilai nol. Informasi harga yang tidak disediakan endpoint tetap ditampilkan sebagai unknown pada data metadata.
- Batas publik yang saat ini didokumentasikan untuk ketiga model tersebut adalah 30 RPM, 1.000 RPD, 8.000 TPM, dan 200.000 TPD per model. Batas akun yang tampil di Groq Console dapat berbeda; melebihi kuota menghasilkan HTTP 429.
- Penggunaan Free Plan tidak dikenai biaya selama akun tetap berada pada tier gratis dan pemakaian berada dalam batasnya. Upgrade ke Developer Tier mengaktifkan pay-as-you-go dan dapat menimbulkan tagihan.

### 3. Agentic Coding compatibility
- Groq memakai jalur OpenAI-compatible Agent Runtime untuk streaming dan tool calls.
- Menambahkan pengujian katalog Free Plan, filtering model aktif, endpoint, Bearer API key, connection test, dan capability diagnostic termasuk function calling.
- Model tetap harus menjalani **Uji kemampuan** di aplikasi; badge Free Plan tidak berarti tool-calling sudah diverifikasi oleh aplikasi.
- 9Router tetap Local Only di `http://localhost:20128/v1`; tidak ada perubahan remote fallback.
- Provider Gemini yang sudah ada tidak diubah dalam rilis ini.

### Detail Version di dalam aplikasi
Buka nomor versi pada bilah status bawah untuk melihat **deskripsi perubahan/fitur/perbaikan** v1.2.0. Riwayat menampilkan **maksimal tiga rilis terbaru**. Gunakan tombol **Muat Ulang Versi** untuk memperbarui daftar dan deskripsi dari GitHub.

---

# Ruang Kerja v1.1.1

## Agentic Coding AI — perbaikan deadlock Todo Orchestrator dan discovery workspace

### 1. Perbaikan akar masalah tool yang terus ditahan
- Memperbaiki kebijakan Todo Orchestrator yang sebelumnya menahan `read_project_file`, `list_project_files`, dan `search_project_files` ketika Todo List belum dibuat.
- Agent sekarang boleh melakukan discovery read-only terlebih dahulu untuk memahami struktur proyek dan membaca file relevan.
- Todo List tetap wajib dibuat sebelum tindakan yang mengubah workspace atau state, seperti menulis file, menjalankan terminal, menulis session memory, atau memanggil tool/plugin yang tidak dikenal.
- Menghilangkan false-positive deteksi Todo yang sebelumnya menganggap kata benda umum seperti "project", "proyek", "website", dan "aplikasi" sebagai bukti bahwa permintaan pasti multi-langkah.

### 2. Perbaikan instruksi Agent
- Memperjelas urutan kerja: pahami workspace melalui inventory/read/search, susun rencana berdasarkan temuan, buat Todo untuk pekerjaan substantif, lalu lakukan perubahan secara berurutan.
- Discovery tidak lagi terjebak oleh prasyarat Todo yang justru membutuhkan discovery untuk disusun.
- Tool mutatif tetap dilindungi oleh prasyarat Todo untuk pekerjaan multi-langkah.

### 3. Regression tests
- Menambahkan test policy untuk memastikan read-only discovery diizinkan sebelum Todo.
- Memastikan write, terminal, session-memory write, dan tool/plugin yang tidak dikenal tetap ditahan sampai Todo tersedia.
- Memastikan permintaan sederhana yang tidak memerlukan Todo tidak diblokir, dan tool dapat berjalan normal setelah Todo dibuat.
- Test policy baru dimasukkan ke gerbang Agent Runtime CI.

### 4. Terminal runtime dan verifikasi
- Memperbaiki wrapper PowerShell dengan menginisialisasi `$global:LASTEXITCODE` dan menjalankan command melalui `Invoke-Expression` pada scope yang sama dengan pembacaan exit code; kegagalan native program seperti `node`, `npm`, dan `git` tidak lagi berisiko terbaca sukses, termasuk pada runner Windows dengan versi PowerShell berbeda.
- Menambahkan regression test khusus untuk memastikan wrapper PowerShell mempertahankan exit code native.
- Agent Runtime Tests, TypeScript typecheck, dan Windows installer build harus lulus sebelum release.
- Tes ini memverifikasi kebijakan orkestrasi dan format alur eksekusi; pengujian end-to-end tetap perlu memakai 9Router lokal yang aktif dan model yang mendukung tool-calling.

### Detail Version di dalam aplikasi
Buka nomor versi pada bilah status bawah untuk melihat Detail Version. Riwayat menampilkan maksimal tiga rilis terbaru beserta deskripsi perubahan masing-masing versi. Gunakan tombol Muat Ulang Versi untuk mengambil ulang daftar dan deskripsi terbaru dari GitHub.

---

# Ruang Kerja v1.1.0

## AI Coding Agent — 9Router local-only, stabilisasi tool-calling, dan alur coding yang lebih dapat diandalkan

### 1. 9Router Local Only
- Endpoint Agentic Coding AI dikunci ke `http://localhost:20128/v1`; tidak ada endpoint cadangan.
- Seluruh permintaan chat, daftar model, uji koneksi, dan pemeriksaan kemampuan 9Router hanya menggunakan localhost.
- Tailscale, tunnel publik, dan remote fallback tidak lagi dipakai atau dihubungi oleh provider 9Router.
- Saat endpoint lokal gagal, aplikasi melaporkan error koneksi secara langsung dan tidak mengirim API key, prompt, attachment, maupun konteks workspace ke layanan jarak jauh.
- Karena endpoint menggunakan localhost, setiap perangkat yang ingin memakai 9Router harus menjalankan 9Router secara lokal pada perangkat tersebut.

### 2. Perbaikan HTTP 400 pada tool-calling
- Memperbaiki format riwayat percakapan OpenAI-compatible saat assistant mengirim teks dan `tool_calls` dalam satu respons.
- Teks assistant dipisahkan menjadi pesan assistant biasa, sedangkan pesan yang memuat `tool_calls` dikirim dengan `content: null`.
- Urutan deklarasi tool call dan hasil tool tetap dipertahankan agar operasi Todo, pembacaan file, dan perubahan workspace memiliki pasangan pesan yang valid.
- Menambahkan regression test untuk pesan assistant biasa, kombinasi teks dan tool call, serta tool call tanpa teks.
- Memperbarui integration test attachment dan provider agar memeriksa request message yang telah dinormalisasi.

### 3. Ketahanan dan validasi
- Menambahkan regression test bahwa katalog model 9Router tidak mengakses endpoint remote walaupun konfigurasi lama masih membawa fallback.
- Menambahkan pemeriksaan bahwa format payload tool-calling sesuai dengan skema OpenAI-compatible yang ketat.
- Agent Runtime Tests mencakup Todo, terminal, attachments, model capabilities, session, provider, dan integration regression.
- TypeScript typecheck dan Windows installer build menjadi gerbang sebelum rilis diterbitkan.
- Tes otomatis menggunakan mock untuk memverifikasi format payload dan routing lokal; tes tersebut tidak dapat menjamin provider upstream 9Router selalu tersedia atau bebas HTTP 503.

### Detail Version di dalam aplikasi
Buka nomor versi pada bilah status untuk melihat **deskripsi perubahan/fitur/perbaikan** pada setiap versi. Riwayat menampilkan **maksimal tiga rilis terbaru**. Gunakan tombol **Muat Ulang Versi** untuk mengambil ulang detail dan catatan versi dari GitHub.

---

# Ruang Kerja v1.0.9

## Agentic Coding AI — endpoint lokal + Tailscale dan UI lebih bersih

### 1. Koneksi 9Router local-first
- Mengganti endpoint utama default menjadi `http://localhost:20128/v1` agar Host yang menjalankan 9Router memakai koneksi lokal terlebih dahulu.
- Mengganti endpoint cadangan default menjadi `https://bxludp.tailf34d89.ts.net/v1` untuk perangkat anggota Room yang tidak menjalankan 9Router secara lokal.
- Urutan koneksi selalu **Local → Tailscale**. Endpoint lama `abc-tunnel.us` tidak lagi menjadi default.
- Jika endpoint lokal tidak dapat dijangkau, timeout koneksi lokal dibatasi 15 detik sebelum mencoba Tailscale. Jika endpoint lokal mengembalikan HTTP 4xx/5xx termasuk **HTTP 503**, runtime mencoba endpoint Tailscale berikutnya.
- Jika kedua endpoint gagal, aplikasi menampilkan kegagalan koneksi yang sudah disanitasi. Keberhasilan failover tetap bergantung pada Tailscale Serve aktif, hostname dapat dijangkau, akses tailnet diizinkan, 9Router Host aktif, serta API key/model provider valid.
- Endpoint dapat dioverride melalui environment variable `RK_ROUTER_ENDPOINT` dan `RK_ROUTER_FALLBACK`.

### 2. Penyederhanaan UI Agent
- Menghapus bar pemilih agent berwarna biru/toska yang menampilkan tombol **Poolside Coding Agent** di atas area percakapan.
- Agent coding bawaan tetap aktif; yang dihilangkan hanya bar pemilih yang tidak diperlukan.
- Alur percakapan, pemilihan model, status workspace, dan panel Todo/Changes tetap dipertahankan.

### 3. Pengujian dan batas verifikasi
- Menambahkan regression assertions untuk urutan Local → Tailscale, timeout fallback, dan penanganan HTTP non-2xx termasuk 503.
- Menjalankan Agent Runtime tests, TypeScript typecheck, dan build installer Windows melalui CI.
- Tes mock memastikan fallback berjalan saat endpoint lokal gagal/503; tes otomatis tidak dapat menjamin provider eksternal selalu bebas 503. Verifikasi langsung tetap memerlukan 9Router aktif, API key yang valid, serta Tailscale Serve dan akses tailnet yang berfungsi.

### Detail Version di dalam aplikasi
Buka versi pada bilah status bawah untuk melihat catatan v1.0.9. Gunakan **Muat Ulang Versi** untuk memperbarui daftar rilis.

---

# Ruang Kerja v1.0.8

## Agentic Coding AI — katalog model 9router dan tampilan lebih ringkas

Ruang Kerja v1.0.8 memperbarui pilihan model untuk Agentic Coding AI melalui 9router dan merapikan area kerja editor. Perubahan ini mempertahankan alur coding agent, workspace tools, terminal dengan persetujuan, serta sistem riwayat versi yang sudah ada.

### 1. Pilihan model 9router
- Menambahkan `groq/openai/gpt-oss-120b(high)` — GPT-OSS 120B (High) — ke katalog model yang dapat dipilih.
- Menambahkan `cf/@cf/qwen/qwen2.5-coder-32b-instruct(high)` — Qwen 2.5 Coder 32B Instruct (High) — ke katalog model yang dapat dipilih.
- Menambahkan `cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast` — Llama 3.3 70B Instruct FP8 Fast — ke katalog model yang dapat dipilih.
- Menghapus `ps/poolside/laguna-s-2.1(high)` dari daftar model aktif 9router dan menolak pemilihan ulang ID tersebut melalui input model manual.
- Instalasi lama yang masih menyimpan pilihan Poolside/Laguna otomatis beralih ke model GPT-OSS 120B (High), tanpa menghapus API key atau pengaturan provider.
- Model yang disematkan tetap diberi status harga belum diketahui dan tidak diberi klaim kemampuan vision/tool-calling sebelum metadata atau pengujian provider membuktikannya.
- Jika endpoint katalog live 9router gagal, tiga pilihan model tersebut tetap tersedia dengan peringatan yang menjelaskan bahwa akses dan kemampuan perlu diverifikasi saat model digunakan.

### 2. Penyederhanaan tampilan AI Coding Agent
- Menghapus teks tab **AI Coding Agent** yang sebelumnya muncul tepat di atas pemilih **Poolside Coding Agent**.
- Mempertahankan ikon tab dan tombol tutup agar akses kembali ke editor tetap tersedia.
- Tombol pemilih agent dan area percakapan tidak diubah oleh perapian ini.

### 3. Validasi dan kompatibilitas
- Menambahkan regression test untuk ketiga ID model 9router, filter model Laguna, metadata model, dan fallback katalog ketika endpoint live tidak tersedia.
- Memperbarui pemeriksaan UI agar memastikan label tab yang berulang dihapus sementara kontrol navigasi tetap dipertahankan.
- Memperbarui versi aplikasi dan lockfile menjadi **1.0.8** agar versi di bilah status aplikasi sesuai dengan release.
- CI Windows menjalankan Agent Runtime tests, TypeScript typecheck, dan build installer sebelum GitHub Release diterbitkan.
- Ketersediaan model, batas pemakaian, harga, dan dukungan tool-calling tetap mengikuti akun serta endpoint 9router; lakukan **Uji kemampuan** untuk model aktif sebelum mengandalkan operasi coding otomatis.

### Detail Version di dalam aplikasi
Buka nomor versi pada bilah status bawah untuk melihat **Detail Version**. Setelah rilis v1.0.8 diterbitkan, aplikasi mengambil deskripsi perubahan ini dari GitHub dan menampilkannya di urutan teratas bersama maksimal dua rilis sebelumnya. Gunakan **Muat Ulang Versi** untuk memperbarui daftar dan deskripsi release.

---

# Ruang Kerja v1.0.7

## Agentic Coding AI — lampiran multimodal dan kontrol pesan yang lebih tangguh

Ruang Kerja v1.0.7 menyelesaikan putaran hardening untuk lampiran AI dan kontrol riwayat pesan. Fokus rilis ini adalah mencegah lampiran yang tidak valid atau telah kedaluwarsa diproses seolah-olah berhasil, membatasi penggunaan memori saat membaca dokumen, dan membuat tindakan rewind/refork lebih konsisten.

### 1. Lampiran gambar, dokumen, audio, dan video

- Memperkuat validasi lampiran dengan memeriksa signature berkas dan byte aktual, bukan hanya ekstensi atau MIME yang diberikan nama file.
- PDF yang memiliki halaman hasil scan maupun campuran teks terpilih dan halaman scan dapat dikirim sebagai dokumen PDF asli ke jalur multimodal Google Gemini. Ini memungkinkan model memeriksa tata letak dan halaman gambar; hasil tetap bergantung pada kemampuan dan respons provider yang dipilih.
- Menambahkan jalur lampiran audio dan video, termasuk pemetaan MIME yang sesuai untuk berkas M4A. Instruksi ke model sekarang menjelaskan semua format yang terpasang dalam satu pesan, bukan hanya format pertama yang ditemukan.
- Memperjelas kegagalan provider: bila provider/model tidak menerima media langsung yang dipilih, aplikasi mengembalikan pesan yang jelas dan tidak mengklaim telah menganalisis media tersebut.
- Membatasi media langsung maksimal **12 MiB per file** dan total media langsung **12 MiB per pesan**. Ukuran payload JSON inline juga dibatasi di bawah **19.000.000 byte** untuk memberi ruang bagi overhead Base64, prompt, dan skema tool di bawah batas request inline provider.

### 2. Proteksi pemrosesan PDF dan dokumen Office

- Membatasi ekspansi PDF secara agregat hingga **50 MiB**, membatasi jumlah stream yang diproses, dan menjaga batas output dekompresi per stream agar PDF terkompresi ekstrem tidak menghabiskan memori secara tidak terkendali.
- Membatasi arsip Office hingga **2.000 entri** dan total hasil ekspansi **50 MiB** sebelum mengekstrak teks atau nilai sel.
- Memperketat decoding entitas XML dan menambahkan pemeriksaan untuk berkas malformed serta input yang dapat memicu penggunaan stack atau memori berlebihan.
- Jika referensi lampiran sudah kedaluwarsa atau tidak cocok dengan byte yang tersedia, agent sekarang membatalkan permintaan dengan alasan yang bisa ditindaklanjuti. Lampiran yang hilang tidak lagi diam-diam berubah menjadi permintaan kosong yang berpotensi disalahartikan sebagai analisis sukses.

### 3. Aksi per pesan: Revert, Refork, Copy, dan Rewind

- Menyediakan aksi pesan yang lebih konsisten untuk menyalin pesan, mengembalikan perubahan, membuat cabang percakapan dari prompt terpilih, atau memulihkan checkpoint workspace.
- **Refork** membuat sesi baru dengan riwayat sebelum prompt yang dipilih dan mengembalikan prompt itu ke composer supaya pengguna dapat mengubah atau mengirim ulang arahnya. Lampiran tidak disalin sebagai byte permanen ke sesi baru; pilih ulang lampiran yang diperlukan.
- **Rewind** mengembalikan perubahan file ke checkpoint yang dipilih. Perubahan eksternal yang bertabrakan tetap diperiksa alih-alih ditimpa tanpa peringatan.
- Memperbaiki kasus ketika ukuran checkpoint melewati batas: file checkpoint yang sudah tersimpan sebelumnya tetap dipertahankan sehingga checkpoint valid yang lama tidak ikut terhapus.
- Aksi Copy tetap terpisah dari perubahan workspace; kegagalan aksi harus memberi umpan balik, bukan diam-diam dianggap berhasil.

### 4. Pintasan Ctrl+R yang kontekstual

- Ctrl+R hanya bertindak sebagai Rewind/Redo ketika fokus berada pada menu aksi untuk pesan pengguna yang sesuai; pintasan tidak mengambil alih pengetikan normal di kolom teks.
- Jika checkpoint terkait masih dalam status diterapkan, aksi menjalankan Rewind; jika checkpoint sudah di-rewind, aksi menjalankan Redo.
- Handler mengikuti daftar pesan terbaru setelah pesan baru, Refork, atau pergantian sesi agar tidak menggunakan state React yang sudah kedaluwarsa.

### Detail Version di dalam aplikasi

- Klik nomor versi pada bilah status bawah aplikasi untuk membuka **Riwayat Versi & Perubahan**. Fitur tersedia dari layar awal maupun saat berada di dalam ruangan kerja.
- Setiap entri menampilkan tag/nomor versi, nama rilis bila tersedia, tanggal publikasi, dan isi deskripsi rilis. Catatan v1.0.7 ini menjadi sumber deskripsi perubahan yang ditampilkan di aplikasi.
- Daftar menampilkan maksimal **tiga rilis terbaru**; riwayat versi yang lebih lama tetap disimpan di repositori dan GitHub Releases.
- Tombol **Muat Ulang Versi** mengambil ulang deskripsi dari GitHub. Tombol **Cek Pembaruan** memeriksa installer baru melalui sistem auto-update.
- Jika GitHub API gagal atau terkena rate limit, aplikasi mencoba release feed dan kemudian cache lokal yang tersedia. Bila semua sumber gagal dan tidak ada cache, aplikasi menampilkan pesan error yang jelas alih-alih mengarang deskripsi.

### 6. Validasi dan batasan rilis

- CI Windows menjalankan regression tests Agent Runtime, TypeScript typecheck, dan build aplikasi sebelum perubahan rilis diterima.
- Workflow rilis membangun installer NSIS Windows, lalu memeriksa bahwa latest.yml menunjuk ke installer yang benar dan blockmap tersedia sebelum GitHub Release diterbitkan.
- Tes otomatis memeriksa jalur logika dan build, tetapi tidak menggantikan smoke test manual pada installer Windows dan panggilan langsung ke setiap provider. Kemampuan audio/video tetap bergantung pada model dan provider yang dipilih.
- Rilis ini memperbaiki kasus yang direproduksi dan menambah batas keselamatan; ini bukan klaim bahwa setiap provider eksternal, berkas malformed, jaringan, atau mesin pengguna bebas dari semua kemungkinan kegagalan.

---

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
