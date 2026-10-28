import { useEffect,useState } from 'react';
import type { AgentSkillInfo } from '../../../shared/agents';
import './skills-pane.css';

export function SkillsPane() {
  const [skills,setSkills]=useState<AgentSkillInfo[]>([]);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;
    void window.rk.agentListSkills()
      .then(items=>{if(alive)setSkills(items);})
      .catch(err=>{if(alive)setError((err as Error).message||'Gagal memuat daftar skill.');});
    return ()=>{alive=false;};
  },[]);
  return <section className="ed-skills" aria-label="AI Skills">
    <header className="ed-side-head"><span className="ed-side-title">Skills</span><span className="ed-skills-count">{skills.length}</span></header>
    <p className="ed-skills-intro">Skill membantu AI memilih alur kerja yang sesuai dengan permintaan dan lampiran.</p>
    {error?<div className="ed-skills-error" role="alert">{error}</div>:null}
    {skills.length===0&&!error?<div className="ed-empty">Memuat daftar skill…</div>:null}
    <div className="ed-skills-list">{skills.map(skill=><article className="ed-skill-card" key={skill.id}>
      <div className="ed-skill-card-head"><strong>{skill.name}</strong><span>Bawaan</span></div>
      <p>{skill.reason}</p><div className="ed-skill-card-footer"><code>{skill.id}</code><span>Dipilih otomatis</span></div>
    </article>)}</div>
    <p className="ed-skills-footnote">Daftar ini menampilkan skill bawaan yang terhubung ke agent. Pemasangan skill eksternal, aktivasi manual, plugin, dan MCP belum termasuk tahap ini.</p>
  </section>;
}
