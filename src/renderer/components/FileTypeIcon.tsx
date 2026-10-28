import type { CSSProperties } from 'react';

interface Props {
  path: string;
  size?: 'small' | 'tab' | 'normal';
}
interface Glyph {
  label: string;
  color: string;
  background: string;
  title: string;
}

const GLYPHS: Record<string, Glyph> = {
  html: { label: '5', color: '#e34f26', background: 'rgba(227,79,38,.13)', title: 'HTML' },
  htm: { label: '5', color: '#e34f26', background: 'rgba(227,79,38,.13)', title: 'HTML' },
  css: { label: '#', color: '#42a5f5', background: 'rgba(66,165,245,.14)', title: 'CSS' },
  scss: { label: 'S', color: '#cf649a', background: 'rgba(207,100,154,.14)', title: 'SCSS' },
  sass: { label: 'S', color: '#cf649a', background: 'rgba(207,100,154,.14)', title: 'Sass' },
  less: { label: 'L', color: '#6d85c7', background: 'rgba(109,133,199,.14)', title: 'Less' },
  js: { label: 'JS', color: '#d6b93f', background: 'rgba(214,185,63,.14)', title: 'JavaScript' },
  mjs: { label: 'JS', color: '#d6b93f', background: 'rgba(214,185,63,.14)', title: 'JavaScript module' },
  cjs: { label: 'JS', color: '#d6b93f', background: 'rgba(214,185,63,.14)', title: 'CommonJS' },
  jsx: { label: 'JSX', color: '#56c6e7', background: 'rgba(86,198,231,.14)', title: 'React JSX' },
  ts: { label: 'TS', color: '#3178c6', background: 'rgba(49,120,198,.16)', title: 'TypeScript' },
  tsx: { label: 'TSX', color: '#56c6e7', background: 'rgba(86,198,231,.14)', title: 'React TypeScript' },
  json: { label: '{}', color: '#e3b341', background: 'rgba(227,179,65,.14)', title: 'JSON' },
  md: { label: 'M', color: '#74a8ed', background: 'rgba(116,168,237,.14)', title: 'Markdown' },
  mdx: { label: 'MX', color: '#74a8ed', background: 'rgba(116,168,237,.14)', title: 'MDX' },
  php: { label: 'PHP', color: '#a9a3e8', background: 'rgba(169,163,232,.16)', title: 'PHP' },
  py: { label: 'PY', color: '#6aa9dc', background: 'rgba(106,169,220,.14)', title: 'Python' },
  ipynb: { label: 'NB', color: '#e49a53', background: 'rgba(228,154,83,.14)', title: 'Jupyter Notebook' },
  go: { label: 'GO', color: '#61c3d7', background: 'rgba(97,195,215,.14)', title: 'Go' },
  rs: { label: 'RS', color: '#d98558', background: 'rgba(217,133,88,.14)', title: 'Rust' },
  java: { label: 'J', color: '#e77b55', background: 'rgba(231,123,85,.14)', title: 'Java' },
  kt: { label: 'KT', color: '#a58aec', background: 'rgba(165,138,236,.14)', title: 'Kotlin' },
  cs: { label: 'C#', color: '#a98be2', background: 'rgba(169,139,226,.14)', title: 'C#' },
  cpp: { label: 'C++', color: '#659ad4', background: 'rgba(101,154,212,.14)', title: 'C++' },
  c: { label: 'C', color: '#659ad4', background: 'rgba(101,154,212,.14)', title: 'C' },
  h: { label: 'H', color: '#659ad4', background: 'rgba(101,154,212,.14)', title: 'C/C++ header' },
  sql: { label: 'DB', color: '#e99e45', background: 'rgba(233,158,69,.14)', title: 'SQL' },
  prisma: { label: 'DB', color: '#9ca3af', background: 'rgba(156,163,175,.14)', title: 'Prisma' },
  graphql: { label: 'GQL', color: '#e17cb9', background: 'rgba(225,124,185,.14)', title: 'GraphQL' },
  yml: { label: 'YML', color: '#c39ae8', background: 'rgba(195,154,232,.14)', title: 'YAML' },
  yaml: { label: 'YML', color: '#c39ae8', background: 'rgba(195,154,232,.14)', title: 'YAML' },
  xml: { label: 'XML', color: '#e98b49', background: 'rgba(233,139,73,.14)', title: 'XML' },
  svg: { label: 'SVG', color: '#e6a4ed', background: 'rgba(230,164,237,.14)', title: 'SVG' },
  png: { label: 'IMG', color: '#a8cf80', background: 'rgba(168,207,128,.14)', title: 'Image' },
  jpg: { label: 'IMG', color: '#a8cf80', background: 'rgba(168,207,128,.14)', title: 'Image' },
  jpeg: { label: 'IMG', color: '#a8cf80', background: 'rgba(168,207,128,.14)', title: 'Image' },
  webp: { label: 'IMG', color: '#a8cf80', background: 'rgba(168,207,128,.14)', title: 'Image' },
  gif: { label: 'IMG', color: '#a8cf80', background: 'rgba(168,207,128,.14)', title: 'Image' },
  ico: { label: 'ICO', color: '#a8cf80', background: 'rgba(168,207,128,.14)', title: 'Icon' },
  pdf: { label: 'PDF', color: '#ed7378', background: 'rgba(237,115,120,.14)', title: 'PDF document' },
  sh: { label: 'SH', color: '#a2c780', background: 'rgba(162,199,128,.14)', title: 'Shell script' },
  bat: { label: 'BAT', color: '#a2c780', background: 'rgba(162,199,128,.14)', title: 'Batch file' },
  ps1: { label: 'PS', color: '#6ea5da', background: 'rgba(110,165,218,.14)', title: 'PowerShell' },
  lock: { label: 'L', color: '#9ca3af', background: 'rgba(156,163,175,.12)', title: 'Lock file' },
  env: { label: 'ENV', color: '#e1bb59', background: 'rgba(225,187,89,.14)', title: 'Environment file' },
  gitignore: { label: 'GIT', color: '#e78a68', background: 'rgba(231,138,104,.14)', title: 'Git ignore' },
  dockerfile: { label: 'DK', color: '#56a8ec', background: 'rgba(86,168,236,.14)', title: 'Dockerfile' },
  makefile: { label: 'MK', color: '#9ca3af', background: 'rgba(156,163,175,.12)', title: 'Makefile' },
  readme: { label: 'M', color: '#74a8ed', background: 'rgba(116,168,237,.14)', title: 'README' },
  license: { label: '©', color: '#c4b5fd', background: 'rgba(196,181,253,.14)', title: 'License' },
  generic: { label: '·', color: '#a3aec4', background: 'rgba(163,174,196,.10)', title: 'File' },
};

function resolveGlyph(path: string): Glyph {
  const name = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? path.toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return GLYPHS.dockerfile;
  if (name === 'makefile' || name === 'gnumakefile') return GLYPHS.makefile;
  if (name === 'readme' || name.startsWith('readme.')) return GLYPHS.readme;
  if (name === 'license' || name.startsWith('license.')) return GLYPHS.license;
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') return GLYPHS.gitignore;
  if (name.startsWith('.env') || name === 'env') return GLYPHS.env;
  if (name === 'package-lock.json' || name === 'pnpm-lock.yaml' || name === 'yarn.lock' || name === 'composer.lock') return GLYPHS.lock;
  const lastDot = name.lastIndexOf('.');
  const ext = lastDot >= 0 ? name.slice(lastDot + 1) : '';
  return GLYPHS[ext] ?? GLYPHS.generic;
}

export function FileTypeIcon({ path, size = 'small' }: Props) {
  const glyph = resolveGlyph(path);
  const style: CSSProperties = { color: glyph.color, backgroundColor: glyph.background };
  return (
    <span
      className={\`rk-file-type-icon rk-file-type-icon-\${size}\`}
      style={style}
      title={glyph.title}
      aria-label={glyph.title + ' file'}
    >
      {glyph.label}
    </span>
  );
}
