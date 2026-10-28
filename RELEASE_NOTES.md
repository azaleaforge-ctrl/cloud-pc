# Ruang Kerja v0.4.1

## Terminal VS Code-like (Fixed)
- **Scroll wheel & mouse klik**: terminal xterm.js sekarang menerima event scroll dan klik langsung tanpa
  "lolos" ke parent/webview. Mouse wheel scroll di dalam terminal menggulir scrollbacknya sendiri,
  bukan jendela luar.
- **Kursor fokus**: klik pada terminal langsung memfokuskan xterm dan menampilkan cursor/blink.
  Block cursor style yang jelas dan konsisten.
- **CLI AI Agent support** (OpenCode, KiloCode, Claude Code, dll): semua input/output mentah
  diteruskan ke PTY yang sesungguhnya. Scroll, input, color, ANSI escape codes bekerja sempurna.
- **Search addon** (Ctrl+F): find next/previous, highlight matches, clear decorations.
- **Context menu**: klik kanan → Copy, Paste, Clear, Find.
- **Scrollback** 10.000 baris, WebLinks addon (klik link buka browser).
- **Resize handling** robust dengan FitAddon + ResizeObserver + late layouts.

## Server Laravel / PHP (Fixed)
- **HTTP readiness probe** mencoba endpoint `/`, `/index.php`, `/api`, `/login` secara berurutan
  untuk framework PHP yang butuh lebih lama boot.
- **Probe attempts** dinaikkan dari 20→25, delay 1s untuk PHP/Laravel.
- **Fatal patterns** ditambah: `Class .* does not exist`, `Target class .* does not exist`,
  `Production environment detected`.
- **serverDoctor** sekarang memverifikasi `APP_KEY`, file `.env`, dan `bootstrap/app.php`
  yang ada di folder Laravel sebelum mencoba menjalankan server.
- **URL detection** regex meliputi format `php artisan serve` yang mencetak `127.0.0.1:PORT`.

## Sistem Antrian (Queue) — Real-time & Interaktif
- **Real-time sync**: `holderStartedAt` (waktu mulai bekerja) disinkronkan real-time
  ke semua anggota ruangan. UI menampilkan durasi bekerja aktual.
- **Request Turn** (tombol di QueueTab): member yang tidak jadi holder bisa
  mengklik "Meminta Giliran" untuk meminta giliran ke holder yang sedang bekerja.
- **Turn conflict**: ketika holder sedang bekerja dan ada yang request,
  holder dapat notifikasi popup berwarna merah di atas + toast warning.
  Requester otomatis dimasukkan ke antrian.
- **Working list**: QueueTab menampilkan siapa sedang bekerja + durasi,
  diikuti daftar antrean menunggu lengkap dengan posisi dan nama.
- **Release turn manual**: holder bisa klik "Lepas Giliran Sekarang" untuk
  melepas giliran secara manual tanpa menunggu timeout.
- **Auto-assign saat folder kosong**: host yang membuat file pertama otomatis
  dapat giliran, juga member pertama yang connect dan ada aktivitas.
- **Idle timeout** 2 menit untuk semua sumber (manual edit, AI agent, terminal).
  Warning notifikasi 90 detik sebelum auto-release.
- **All activity sources real-time**: file save, editor change, AI agent, terminal,
  dan IDE activity semuanya dilaporkan secara real-time lewat WebSocket.

## Perbaikan UI
- QueueTab diperbarui: working list, request turn button, working duration timer.
- Queue notice conflict styling (border merah).
- `turn-taken` message menyertakan `startedAt` untuk tracking durasi.

---

# Ruang Kerja v0.4.0

## Editor & Terminal (VS Code-like)
- **Terminal tidak auto-buka** saat masuk tab Editor — buka manual via tombol `+` atau Ctrl+`
- **Terminal VS Code-grade**:
  - Search addon (Ctrl+F): find next/previous, highlight matches
  - Scrollback 10.000 baris
  - Right-click context menu: Copy, Paste, Clear, Find
  - WebLinks addon: klik link di terminal buka browser
  - Unicode 15, CRLF conversion, better font rendering
  - Resize handling yang robust (FitAddon + ResizeObserver)
- **CLI AI Agent support** (opencode, kilocode, Claude Code, dll):
  - Terminal sekarang pass-through semua input/output ke PTY asli
  - Scroll, input, color, ANSI escape codes bekerja sempurna
  - Bukan "simulasi" — ini xterm.js asli di atas PTY (ConPTY/pty.js)

## Sistem Antrian (Queue) — Rewrite Total
- **Bekerja di folder kosong**: Antrian aktif sejak room dibuat, tidak butuh file
- **Auto-detect aktivitas** (via activity monitor):
  - AI agent CLI (opencode, kilocode, kodex, aider, dll) → masuk antrian otomatis
  - Manual edit file → masuk antrian otomatis
  - Terminal activity → masuk antrian otomatis
- **UI Antrian Real-time**:
  - **Atas**: "Sedang Bekerja" — nama + aktivitas (edit/agent/terminal)
  - **Bawah**: Daftar antrian menunggu (posisi, nama)
  - **Non-dismissible bar** di pojok kanan atas saat ada yg nunggu
- **Idle timeout 2 menit** (manual/AI agent):
  - Warning notifikasi 45 detik sebelum auto-release
  - Auto-release → next in queue dapat giliran + notifikasi
- **Approve/Reject popup** saat holder selesai & ada antrian:
  - Kotak dialog: "X ingin bekerja" + Approve / Tolak
  - Auto-approve 15 detik jika tidak diklik
- **File sync real-time** di footer kanan bawah (sinkron X berkas)

## Website Tab
- **Navigasi Back/Forward** (toolbar: ◀ ▶)
- URL editable (klik untuk edit, Enter untuk buka)
- Auto-sync dari server URL saat server start

## Update System
- **Manual download**: Tombol kuning "Update Tersedia" di footer & notifikasi
- Klik → download → progress → "Pasang & Mulai Ulang"
- "Cek Pembaruan" hanya cek, tidak auto-download
- **Detail versi lengkap** di modal: catatan rilis per versi (maksimal 3 versi)

## Perbaikan Lain
- Hapus tulisan "deteksi IDE XX" di footer
- **Real-time updates** seluruh UI (state, queue, server, files, terminal)
- Laravel server: HTTP probe delay 1s (was 500ms), 20 attempts, lebih fatal patterns PHP
- Close app benar-benar keluar (isQuitting flag)
- Panel resize: drag UP=expand, DOWN=collapse (VS Code behavior)

---

# Ruang Kerja v0.3.9

## Perbaikan Editor & Panel
- **Editor background**: Editor tetap hidup (mounted) saat pindah tab; terminal, breakpoint, dan state Monaco tidak reset. Masuk tab Editor = full size.
- **Panel resize (terminal/masalah/output)**: Tarik **naik = expand**, **turun = collapse** (seperti VS Code). Double-click resizer = toggle panel. Min height 60px, max 85% viewport.

## Ekstensi Editor (tab baru: **Ekstensi**)
- Ganti tab **IDE Eksternal** → **Ekstensi**.
- Cari & pasang dari Open VSX, installed extensions show themes/snippets/unsupported count, uninstall button.

## Sistem Antrian (Queue) — Unified
- **AI agent** + **Manual coding** share one queue. Manual coding: 1-min idle (45s warning) → auto-release. AI: 2-min idle.

## Website Tab — URL editable
- Toolbar: **klik URL** → edit manual, **Enter** → buka. Auto-syncs from server URL on start.

## Update Behavior — Manual
- `autoDownload = false`. Yellow "Update Tersedia" button appears in footer & notification.
- Click → downloads → "Pasang & Mulai Ulang". "Cek Pembaruan" only checks.

## App Close Fixed
- X/Alt+F4 = hide to tray. Tray "Keluar" = `isQuitting=true` → full shutdown.

## RELEASE_NOTES.md updated with full v0.3.9 changelog.

---

# Ruang Kerja v0.3.8

## Fixed Issues:
1. **Editor background running** - Editor stays mounted when switching tabs, full size on editor tab
2. **Terminal/Problems panel resize** - VSCode-like drag behavior, double-click to toggle
3. **IDE External → Extensions tab** - Search/install from Open VSX, enable/disable, show installed/available
4. **Queue system** - AI agent + manual coding share queue, manual coding 1min idle timeout
5. **Website tab URL** - Editable, auto-detect from project folder
6. **Laravel server** - Fixed "Server mencetak alamat, tetapi belum memberi respons HTTP"
7. **Close app behavior** - Fully close when closing from tray/background

Build & Release: v0.3.8 tagged and pushed.
