// Color helpers for planning UI badges/avatars

export function deriveColors(base: string): { bg: string; border: string; text: string } {
  const hex = base.startsWith('#') ? base.slice(1) : base;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { bg: '#eef2ff', border: '#c7d2fe', text: '#1e293b' };
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lighten = (ch: number) => Math.round(ch + (255 - ch) * 0.90);
  const lr = lighten(r), lg = lighten(g), lb = lighten(b);
  const bg = `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
  return { bg, border: '#' + hex, text: '#1e293b' };
}

export function creatorInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const p = parts[0];
    if (p.length >= 2) return (p[0] + p[1]).toUpperCase();
    return p[0].toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function creatorColor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue} 70% 42%)`,
    ring: `hsl(${hue} 75% 60% / 0.65)`
  };
}
