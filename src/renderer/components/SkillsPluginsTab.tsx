import { useEffect, useMemo, useState } from 'react';
import type { McpPluginSummary } from '../../shared/agents';

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
  ['Test-Driven Development', 'Siklus tes, implementasi, dan verifikasi.', 'https://github.com/obra/superpowers'],
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
  const [installedSkills, setInstalledSkills] = useState<Array<{ id: string; name: string; fileName: string; size: number }>>([]);
  const [mcpPlugins, setMcpPlugins] = useState<McpPluginSummary[]>([]);
  const [pluginResults, setPluginResults] = useState<Record<string, string[] | string>>({});
  const [busy, setBusy] = useState(false);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const items = mode === 'skills' ? SKILLS : PLUGINS;
  const filtered = useMemo(() => items.filter(([name, description]) => (name + ' ' + description).toLowerCase().includes(query.toLowerCase())), [items, query]);

  const refreshInstalledSkills = async () => {
    try { setInstalledSkills(await window.rk.agentListInstalledSkills()); }
    catch (error) { onError((error as Error).message || 'Gagal memuat skill terpasang.'); }
  };
  const refreshMcpPlugins = async () => {
    try { setMcpPlugins(await window.rk.agentListMcpPlugins()); }
    catch (error) { onError((error as Error).message || 'Gagal memuat konfigurasi MCP.'); }
  };
  useEffect(() => {
    let alive = true;
    if (mode === 'skills') {
      void window.rk.agentListInstalledSkills().then(items => { if (alive) setInstalledSkills(items); })
        .catch(error => { if (alive) onError((error as Error).message || 'Gagal memuat skill terpasang.'); });
    } else {
      void window.rk.agentListMcpPlugins().then(items => { if (alive) setMcpPlugins(items); })
        .catch(error => { if (alive) onError((error as Error).message || 'Gagal memuat konfigurasi MCP.'); });
    }
    return () => { alive = false; };
  }, [mode]);

  const importSkill = async () => {
    setBusy(true);
    try {
      const result = await window.rk.agentImportSkill();
      if (result.cancelled) return;
      if (!result.ok || !result.skill) { onError(result.error || 'Skill gagal diimpor.'); return; }
      await refreshInstalledSkills();
    } catch (error) { onError((error as Error).message || 'Skill gagal diimpor.'); }
    finally { setBusy(false); }
  };
  const removeSkill = async (id: string) => {
    setBusy(true);
    try {
      const result = await window.rk.agentUninstallSkill(id);
      if (!result.ok) { onError(result.error || 'Skill gagal dihapus.'); return; }
      await refreshInstalledSkills();
    } catch (error) { onError((error as Error).message || 'Skill gagal dihapus.'); }
    finally { setBusy(false); }
  };
  const importMcpConfig = async () => {
    setBusy(true);
    try {
      const result = await window.rk.agentImportMcpConfig();
      if (result.cancelled) return;
      if (!result.ok) { onError(result.error || 'Konfigurasi MCP gagal diimpor.'); return; }
      setPluginResults({});
      await refreshMcpPlugins();
    } catch (error) { onError((error as Error).message || 'Konfigurasi MCP gagal diimpor.'); }
    finally { setBusy(false); }
  };
  const toggleMcpPlugin = async (plugin: McpPluginSummary) => {
    setBusyPluginId(plugin.id);
    try {
      const nextEnabled = !plugin.enabled;
      const result = await window.rk.agentSetMcpPluginEnabled(plugin.id, nextEnabled);
      if (!result.ok) { onError(result.error || 'Status MCP plugin gagal diubah.'); return; }
      if (!nextEnabled) {
        setPluginResults(previous => { const next = { ...previous }; delete next[plugin.id]; return next; });
      } else {
        const probe = await window.rk.agentProbeMcpPlugin(plugin.id);
        if (!probe.ok) {
          setPluginResults(previous => ({ ...previous, [plugin.id]: probe.error || 'Koneksi MCP gagal.' }));
          await window.rk.agentSetMcpPluginEnabled(plugin.id, false);
          onError(plugin.name + ': ' + (probe.error || 'Koneksi MCP gagal.') + ' Plugin dinonaktifkan kembali.');
        } else {
          setPluginResults(previous => ({ ...previous, [plugin.id]: probe.tools }));
        }
      }
      await refreshMcpPlugins();
    } catch (error) { onError((error as Error).message || 'Status MCP plugin gagal diubah.'); }
    finally { setBusyPluginId(null); }
  };
  const probeMcpPlugin = async (plugin: McpPluginSummary) => {
    setBusyPluginId(plugin.id);
    try {
      const result = await window.rk.agentProbeMcpPlugin(plugin.id);
      if (!result.ok) {
        setPluginResults(previous => ({ ...previous, [plugin.id]: result.error || 'Koneksi MCP gagal.' }));
        onError(result.error || 'Koneksi MCP gagal.');
      } else {
        setPluginResults(previous => ({ ...previous, [plugin.id]: result.tools }));
      }
    } catch (error) { onError((error as Error).message || 'Tes koneksi MCP gagal.'); }
    finally { setBusyPluginId(null); }
  };
  const removeMcpPlugin = async (plugin: McpPluginSummary) => {
    setBusyPluginId(plugin.id);
    try {
      const result = await window.rk.agentRemoveMcpPlugin(plugin.id);
      if (!result.ok) { onError(result.error || 'MCP plugin gagal dihapus.'); return; }
      setPluginResults(previous => { const next = { ...previous }; delete next[plugin.id]; return next; });
      await refreshMcpPlugins();
    } catch (error) { onError((error as Error).message || 'MCP plugin gagal dihapus.'); }
    finally { setBusyPluginId(null); }
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{mode === 'skills' ? 'Skill Agentic Coding' : 'Plugin AI Agent'}</h1>
          <p>{mode === 'skills' ? 'Workflow dan instruksi untuk meningkatkan kualitas coding agent.' : 'Integrasi tool eksternal untuk browser, repositori, dokumentasi, dan sumber data.'}</p>
        </div>
      </header>
      {mode === 'skills' ? (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div><h2 style={{ margin: 0 }}>Skill terpasang ({installedSkills.length})</h2><p className="muted" style={{ marginBottom: 0 }}>Skill impor ditambahkan ke konteks AI agent. File Markdown tidak dijalankan sebagai kode.</p></div>
            <button type="button" className="btn btn-primary" onClick={() => void importSkill()} disabled={busy}>{busy ? 'Memproses…' : 'Impor SKILL.md'}</button>
          </div>
          {installedSkills.length ? <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            {installedSkills.map(skill => <article key={skill.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div><strong>{skill.name}</strong><div className="muted"><code>{skill.fileName}</code> · {(skill.size / 1024).toFixed(1)} KB</div></div>
              <button type="button" className="btn btn-secondary" onClick={() => void removeSkill(skill.id)} disabled={busy}>Hapus</button>
            </article>)}
          </div> : <p className="muted" style={{ marginBottom: 0, marginTop: 14 }}>Belum ada skill impor.</p>}
        </div>
      ) : (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div><h2 style={{ margin: 0 }}>Plugin MCP ({mcpPlugins.length})</h2><p className="muted" style={{ marginBottom: 0 }}>Impor konfigurasi MCP standar. Plugin baru nonaktif dan hanya dijalankan setelah kamu mengaktifkan serta menyetujui penggunaan tool.</p></div>
            <button type="button" className="btn btn-primary" onClick={() => void importMcpConfig()} disabled={busy}>{busy ? 'Memproses…' : 'Impor konfigurasi MCP'}</button>
          </div>
          <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>Konfigurasi harus memiliki properti <code>mcpServers</code> dengan <code>command</code>, opsional <code>args</code>, dan <code>env</code>. Nilai env yang berisi secret wajib memakai referensi seperti <code>{"${GITHUB_TOKEN}"}</code>, bukan token literal.</p>
          {mcpPlugins.length ? <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {mcpPlugins.map(plugin => {
              const probeResult = pluginResults[plugin.id];
              const toolNames = Array.isArray(probeResult) ? probeResult : null;
              const probeError = typeof probeResult === 'string' ? probeResult : null;
              const isBusy = busyPluginId === plugin.id;
              return <article key={plugin.id} className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{plugin.name}</strong>
                    <div className="muted">Command: <code>{plugin.command}</code></div>
                    <div className="muted">Env: {plugin.environmentKeys.length ? plugin.environmentKeys.join(', ') : 'tidak ada'}</div>
                    <div className="muted">{plugin.enabled ? 'Aktif · tool tersedia untuk sesi agent berikutnya' : 'Nonaktif'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className={plugin.enabled ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => void toggleMcpPlugin(plugin)} disabled={busy || isBusy}>{isBusy ? 'Memproses…' : plugin.enabled ? 'Nonaktifkan' : 'Aktifkan & uji'}</button>
                    {plugin.enabled ? <button type="button" className="btn btn-secondary" onClick={() => void probeMcpPlugin(plugin)} disabled={busy || isBusy}>Uji koneksi</button> : null}
                    <button type="button" className="btn btn-ghost" onClick={() => void removeMcpPlugin(plugin)} disabled={busy || isBusy}>Hapus</button>
                  </div>
                </div>
                {toolNames ? <div className="muted">Tools terdeteksi ({toolNames.length}): {toolNames.length ? toolNames.join(', ') : 'server tidak menyediakan tools'}</div> : null}
                {probeError ? <div role="alert" className="muted">Tes terakhir gagal: {probeError}</div> : null}
              </article>;
            })}
          </div> : <p className="muted" style={{ marginBottom: 0, marginTop: 14 }}>Belum ada konfigurasi MCP yang terpasang.</p>}
          <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>Tool dari plugin eksternal selalu meminta persetujuan sebelum dipanggil. Hanya aktifkan server dari sumber yang kamu percaya; proses MCP berjalan dengan izin akun Windows-mu, bukan di sandbox.</p>
        </div>
      )}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label htmlFor="agent-catalog-search" className="field-label">Cari katalog</label>
        <input id="agent-catalog-search" className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'skills' ? 'Cari skill...' : 'Cari plugin...'} />
        <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
          {mode === 'skills' ? 'Sumber eksternal hanya menjadi referensi. Untuk memasang skill, impor file SKILL.md yang sudah kamu tinjau.' : 'Katalog di bawah adalah referensi sumber. Untuk mengaktifkan salah satunya, ikuti instruksi resmi dan impor konfigurasi MCP-nya.'}
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
