# Ruang Kerja v0.4.2

## Terminal VS Code-like (Critical Fix)

### Masalah yang Diperbaiki:
1. **Kursor I-beam (bar ketik) pada terminal** — I-beam sudah tidak muncul lagi pada kanvas terminal xterm.js. Cursor otomatis `default` (panah) saat berada di area canvas terminal. TUI apps (htop, lazygit, opencode) kursor konsisten.
2. **Scroll jamet / macet saat TUI** — Scroll wheel tidak lagi "tersangkut" di parent webview. Wheel event di-tangkap dengan `capture: true` + `stopPropagation()`, sehingga xterm mengelola scrollback-nya sendiri. Scroll halus untuk aplikasi CLI berbasis TUI.
3. **Ukuran grid terminal tidak pas (resize mismatch)** — `FitAddon.fit()` dijalankan saat:
   - Session terminal baru dibuat (via `requestAnimationFrame` setelah `term.open`)
   - Window resize (via `window.addEventListener('resize')`)
   - Container resize (via `ResizeObserver`)
   - Session visibility berubah (via `requestAnimationFrame` di visibility effect)
   - Semua kasus memicu `ptyProcess.resize(cols, rows)` ke backend untuk sync PTY grid.
4. **OpenCode plugin error (nineRemoteNotify.js corrupt/missing)** — Dokumentasi pembersihan plugin ditambahkan di bawah.

### Perubahan Teknis:
- **CSS**: `.xterm-screen canvas { cursor: default !important; }`, `.xterm-viewport { overflow-y: auto !important; }`
- **TerminalPane.tsx**:
  - `cursorStyle: 'block'`, `allowProposedApi: true` di konfigurasi Terminal
  - Wheel handler: `host.addEventListener('wheel', wheelHandler, { passive: false, capture: true })`
  - Click handler: `host.addEventListener('mousedown', clickHandler)` → `term.focus()`
  - `requestAnimationFrame` fit setelah `term.open()` untuk initial layout
  - `ResizeObserver` + `window resize` listener → `fitTerminal()` + `resizeTerminal()`
- **editor.css**: xterm scrollbar, cursor blink animation, canvas cursor override

### Plugin OpenCode Cleanup:
Jika terlihat error:
```
Plugin failed: C:\Users\Yahuu\.config\opencode\plugin\nineRemoteNotify.js
```
Lakukan pembersihan otomatis:
```bash
opencode plugin remove nineRemoteNotify
```
Atau hapus manual:
```powershell
Remove-Item "C:\Users\Yahuu\.config\opencode\plugin\nineRemoteNotify.js" -ErrorAction SilentlyContinue
```

---

# Ruang Kerja v0.4.1

## Terminal VS Code-like (Fixed)
- **Scroll wheel & mouse klik**: terminal xterm.js sekarang menerima event scroll dan klik langsung tanpa
  "lolos" ke parent/webview. Mouse wheel scroll di dalam terminal menggulir scrollbacknya sendiri,
  bukan jendela luar.
- **Kursor fokus**: klik pada terminal langsung memfokuskan xterm dan menampilkan cursor/blink.
- **CLI AI Agent support** (OpenCode, KiloCode, Claude Code, dll): semua input/output mentah
  diteruskan ke PTY yang sesungguhnya.
- **Search addon** (Ctrl+F): find next/previous, highlight matches.
- **Context menu**: klik kanan → Copy, Paste, Clear, Find.

## Server Laravel / PHP (Fixed)
- **HTTP readiness probe** mencoba endpoint `/`, `/index.php`, `/api`, `/login`.
- **Probe attempts** dinaikkan ke 25, delay 1s untuk PHP/Laravel.
- **serverDoctor** memverifikasi `APP_KEY`, `.env`, `bootstrap/app.php`.

## Sistem Antrian (Queue) — Real-time & Interaktif
- **`holderStartedAt`** disinkronkan real-time, UI menampilkan durasi bekerja.
- **Request Turn button**: member bisa request giliran ke holder yang sedang bekerja.
- **Turn conflict**: holder dapat notifikasi popup merah + toast warning.
- **QueueTab**: working list, request turn button, manual release button.

---

# Ruang Kerja v0.4.0

## Editor & Terminal (VS Code-like)
- Terminal tidak auto-buka, search addon (Ctrl+F), scrollback 10k, context menu.
- CLI AI Agent support (opencode, kilocode, Claude Code): xterm.js + PTY asli.

## Sistem Antrian — Rewrite Total
- Auto-detect aktivitas: AI agent, manual edit, terminal.
- UI real-time: working list, antrean menunggu, idle timeout 2 menit.
- Approve/Reject popup (15s auto-approve), file sync real-time.

## Website Tab, Update System, dan lainnya
- Back/forward nav, URL editable, manual download update, 3 versi changelog.
