import { useMemo, useState } from 'react';

type Mode = 'skills' | 'plugins';

const SKILLS = [
  ['Agent Skills', 'Format skill portabel untuk coding agent.', 'https://github.com/anthropics/skills'],
  ['Superpowers', 'Workflow brainstorming, perencanaan, TDD, dan verifikasi.', 'https://github.com/obra/superpowers'],
  ['Vercel Agent Skills', 'Workflow pengembangan web dan frontend.', 'https://github.com/vercel-labs/agent-skills'],
  ['UI UX Pro Max', 'Panduan desain UI/UX, layout, warna, dan tipografi.', 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill'],
  ['Frontend Design', 'Prinsip untuk menghindari UI generik.', 'https://github.com/anthropics/skills'],
  ['Playwright Testing', 'Workflow pengujian browser.', 'https://github.com/microsoft/playwright'],
  ['React Best Practices', 'Praktik React dan komponen.', 'https://github.com/vercel/agent-skills'],
  ['Next.js Best Practices', 'Routing, rendering, dan data fetching.', 'https://github.com/vercel/next.js'],
  ['Laravel Best Practices', 'Praktik framework dan struktur Laravel.', 'https://github.com/laravel/laravel'],
  ['Security Review', 'Checklist review keamanan kode.', 'https://github.com/anthropics/skills'],
  ['Debugging', 'Diagnosis akar masalah dan verifikasi perbaikan.', 'https://github.com/obra/superpowers'],
  ['Test-Driven Development', 'Siklus tes, implementasi, dan refactor.', 'https://github.com/obra/superpowers'],
  ['Git Workflows', 'Praktik perubahan aman dan review diff.', 'https://github.com/anthropics/skills'],
  ['Documentation', 'Workflow dokumentasi teknis.', 'https://github.com/anthropics/skills'],
  ['Database Design', 'Panduan schema, migrasi, dan integritas data.', 'https://github.com/laravel/laravel'],
];

const PLUGINS = [
  ['Playwright MCP', 'Kontrol browser, screenshot, dan inspeksi halaman.', 'https://github.com/microsoft/playwright-mcp'],
  ['Filesystem MCP', 'Tool akses file dengan pembatasan direktori.', 'https://github.com/modelcontextprotocol/servers'],
  ['Git MCP', 'Inspeksi status, diff, dan riwayat Git.', 'https://github.com/modelcontextprotocol/servers'],
  ['GitHub MCP', 'Repositori, issues, pull requests, dan review.', 'https://github.com/github/github-mcp-server'],
  ['Fetch MCP', 'Mengambil konten web untuk riset.', 'https://github.com/modelcontextprotocol/servers'],
  ['Memory MCP', 'Penyimpanan fakta terstruktur.', 'https://github.com/modelcontextprotocol/servers'],
  ['Sequential Thinking', 'Memecah masalah kompleks menjadi langkah.', 'https://github.com/modelcontextprotocol/servers'],
  ['Context7 MCP', 'Dokumentasi library/framework sesuai versi.', 'https://github.com/upstash/context7'],
  ['Database MCP', 'Integrasi query database dengan kontrol akses.', 'https://github.com/modelcontextprotocol/servers'],
  ['Chrome DevTools MCP', 'Inspeksi browser, network, dan console.', 'https://github.com/ChromeDevTools/chrome-devtools-mcp'],
];

export function SkillsPluginsTab({ mode, onError }: { mode: Mode; onError: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const items = mode === 'skills' ? SKILLS : PLUGINS;
  const filtered = useMemo(() => items.filter(([name, description]) => (name + ' ' + description).toLowerCase().includes(query.toLowerCase())), [items, query]);
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{mode === 'skills' ? 'Skill Agentic Coding' : 'Plugin AI Agent'}</h1>
          <p>{mode === 'skills' ? 'Workflow dan instruksi untuk meningkatkan kualitas coding agent.' : 'Integrasi tool eksternal untuk browser, repositori, dokumentasi, dan sumber data.'}</p>
        </div>
      </header>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label htmlFor="agent-catalog-search" className="field-label">Cari katalog</label>
        <input id="agent-catalog-search" className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'skills' ? 'Cari skill...' : 'Cari plugin...'} />
        <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
          Katalog sumber open-source. Instalasi otomatis ke runtime agent belum aktif pada build ini; entri di bawah belum terpasang hanya karena tercantum di katalog.
        </p>
      </div>
      <div className="grid-cards">
        {filtered.map(([name, description, url]) => (
          <article className="card" key={name} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 style={{ margin: 0 }}>{name}</h3>
            <p style={{ margin: 0, flex: 1 }}>{description}</p>
            <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary" onClick={() => onError('Tinjau lisensi dan izin akses sebelum mengadopsi kode pihak ketiga.')}>Lihat sumber GitHub ↗</a>
          </article>
        ))}
      </div>
      {filtered.length === 0 ? <p className="muted">Tidak ada hasil yang cocok.</p> : null}
    </section>
  );
}
