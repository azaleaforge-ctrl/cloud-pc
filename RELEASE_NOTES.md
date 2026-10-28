# Ruang Kerja v0.4.4

## AI Agent System — Claude Code / OpenCode / KiloCode style + 9router + Poolside LLM

### Fitur Baru:
1. **AI Agent System built-in** — Sistem agent AI yang mirip Claude Code / OpenCode / KiloCode CLI. Setiap agent adalah plugin yang terisolasi dengan konfigurasi model, provider, endpoint, dan kemampuan (capabilities). Mirip "oh my opencode slim".
   - **Poolside** (🌊): LLM chat agent menggunakan model `ps/poolside/laguna-s-2.1(high)` via 9router. Support streaming chat, file read/write, terminal execution.
   - **Claude Code** (🧠): CLI agent — spawn claude command di PTY, alirkan I/O ke renderer.
   - **OpenCode** (🤖): CLI agent — spawn opencode command di PTY.
   - **KiloCode** (⚡): CLI agent — spawn kilocode command di PTY.
2. **9router integrasi** — Semua permintaan LLM dilalui 9router untuk routing ke model AI.
   - Endpoint utama: `https://rbxludp.abc-tunnel.us/v1`
   - Endpoint cadangan: `http://localhost:20128/v1`
   - API key: `sk-2d3f91fca9150b32-oteucp-a7c362bf`
3. **Chat panel floating** — Panel chat AI di pojok kanan bawah editor (mirip VS Code Copilot panel).
   - Bisa di-toggle lewat Ctrl+Shift+L atau klik tombol 🤖 di header/status bar.
   - Bisa di-minimize ke ikon kecil atau dipakai fullsize.
   - Agent switcher: pilih antar Poolside, Claude Code, OpenCode, KiloCode.

### Arsitektur:
- `src/shared/agents.ts` — tipetype agent: AgentConfig, AgentEntry, ChatMessage, AgentEvent, RouterConfig. Daftar agent built-in dengan model `ps/poolside/laguna-s-2.1(high)`.
- `src/main/editor/agent.ts` — agent runner service. CLI agents dijalankan di PTY (@lydell/node-pty), LLM agents via streaming SSE ke 9router endpoint.
- `src/renderer/components/editor/AgentChat.tsx` — UI panel chat floating (header, agent switcher, message list, input area).
- `src/renderer/components/editor/StatusBar.tsx` — tombol 🤖 AI Agent di status bar.
- `src/renderer/components/Shell.tsx` — logo bot 🤖 di header kanan (hanya di editor tab).
- `src/renderer/components/icons.tsx` — IconBot, IconSend, IconMaximize, IconMinimize.
- `src/preload/index.ts` — IPC bridge: agentList, agentStartChat, agentStartCli, agentSendInput, agentResize, agentStop, onAgentEvent.
- `src/main/index.ts` — registrasi IPC + lifecycle agent service.

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
