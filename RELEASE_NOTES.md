# Ruang Kerja v0.4.3

## AI Agent Chat built-in + 9router Plugin System

### Fitur Baru:
1. **Chat AI Agent built-in** — Panel chat AI langsung di editor, mirip GitHub Copilot di VS Code.
   - Logo bot 🤖 di pojok kanan atas jendela editor.
   - Bisa ditoggle lewat Ctrl+Shift+L atau klik status bar "AI Agent".
   - UI sederhana, bisa diperbesar (fullsize) atau dikecilkan/minimized ke pojok kanan bawah.
2. **Sistem plugin agent mirip oh my opencode slim** — Agent terdaftar sebagai plugin dengan konfigurasi model, provider, endpoint, dan kemampuan (capabilities).
   - **OpenCode** (🤖): Google Gemini 2.0 Flash via 9router, dukung chat + file edit + terminal run.
   - **KiloCode** (⚡): Google Gemini 2.0 Flash Experimental, cepat dan efisien.
   - **Claude Code** (🧠): Claude 3.5 Sonnet via antropik-compatible endpoint.
   - Setiap agent adalah plugin isolatif — ganti model, endpoint, API key, system prompt.
3. **9router integrasi** — Semua permintaan API AI dilalui 9router untuk routing dan load balancing.
   - Endpoint utama: `https://rbxludp.abc-tunnel.us/v1`
   - Endpoint cadangan: `http://localhost:20128/v1`
   - API key: terkonfigurasi lewat settings (sk-2d3f91fca9150b32-oteucp-a7c362bf)
4. **Model terdaftar di 9router** — Agent otomatis memakai model yang sudah terdaftar di akun 9router pengguna.

### Perubahan UI:
- **StatusBar**: tombol 🤖 AI Agent di sebelah kanan (setelah LF).
- **EditorShell**: panel chat floating di pojok kanan bawah, bisa di-minimize ke ikon bulat.
- **Keyboard shortcut**: `Ctrl+Shift+L` untuk toggle chat panel.

### Arsitektur:
- `src/shared/agents.ts` — kontrak tipetype agent, konfigurasi, dan daftar builtin agent.
- `src/renderer/components/editor/AgentChat.tsx` — komponen chat UI (floating panel).
- `src/renderer/components/editor/StatusBar.tsx` — tombol AI Agent di status bar.
- `src/renderer/components/editor/EditorShell.tsx` — integrasi panel chat + keyboard shortcut.
- API chat dilalui `/api/chat` endpoint yang men-forward ke 9router.

---

# Ruang Kerja v0.4.2

## Terminal VS Code-like (Critical Fix)

### Masalah yang Diperbaiki:
1. **Kursor I-beam (bar ketik) pada terminal** — I-beam sudah tidak muncul lagi pada kanvas terminal xterm.js. Cursor otomatis `default` (panah) saat berada di area canvas terminal. TUI apps (htop, lazygit, opencode) kursor konsisten.
2. **Scroll jamet / macet saat TUI** — Scroll wheel tidak lagi "tersangkut" di parent webview. Wheel event di-tangkap dengan `capture: true` + `stopPropagation()`, sehingga xterm mengelola scrollback-nya sendiri.
3. **Ukuran grid terminal tidak pas (resize mismatch)** — `FitAddon.fit()` dijalankan saat session baru, window resize, container resize, dan visibility change.
4. **OpenCode plugin error (nineRemoteNotify.js)** — Dokumentasi pembersihan plugin ditambahkan.

---

# Ruang Kerja v0.4.1

## Terminal VS Code-like (Fixed)
- **Scroll wheel & mouse klik**: terminal xterm.js menerima event scroll dan klik langsung tanpa lolos ke parent/webview.
- **Kursor fokus**: klik pada terminal langsung memfokuskan xterm.
- **CLI AI Agent support** (OpenCode, KiloCode, Claude Code): input/output mentah diteruskan ke PTY asli.
- **Search addon** (Ctrl+F): find next/previous, highlight matches.
- **Context menu**: Copy, Paste, Clear, Find.
