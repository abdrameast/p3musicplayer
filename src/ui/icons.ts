import { s } from './dom';

/** Original line icons, 24×24 grid. `f` paths are filled, `l` paths are stroked. */
interface IconDef {
  f?: readonly string[];
  l?: readonly string[];
}

const ICONS = {
  play: { f: ['M8 5.2v13.6L19.2 12z'] },
  pause: { f: ['M6.8 5h3.6v14H6.8zM13.6 5h3.6v14h-3.6z'] },
  previous: { f: ['M5.5 5h2.2v14H5.5zM19 5.4v13.2L8.6 12z'] },
  next: { f: ['M16.3 5h2.2v14h-2.2zM5 5.4v13.2L15.4 12z'] },
  volume: { f: ['M3.5 9.2h3.6L12 5.4v13.2l-4.9-3.8H3.5z'], l: ['M15.2 9.1a4.2 4.2 0 0 1 0 5.8', 'M17.8 6.4a8 8 0 0 1 0 11.2'] },
  muted: { f: ['M3.5 9.2h3.6L12 5.4v13.2l-4.9-3.8H3.5z'], l: ['M15.5 9.5l5 5', 'M20.5 9.5l-5 5'] },
  repeat: { l: ['M4 11.5V9.2A3.2 3.2 0 0 1 7.2 6H18', 'M15 3l3 3-3 3', 'M20 12.5v2.3a3.2 3.2 0 0 1-3.2 3.2H6', 'M9 21l-3-3 3-3'] },
  list: { l: ['M4 6.5h16', 'M4 12h16', 'M4 17.5h9'], f: ['M17 15l3 2.5-3 2.5z'] },
  sync: { l: ['M2.5 12h2.8l2.1-5.5 3.2 11 3.1-14 2.9 12.5 1.8-4h3.1'] },
  mode: { l: ['M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z'] },
  fullscreen: { l: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'] },
  fullscreenExit: { l: ['M9 4v5H4', 'M20 9h-5V4', 'M15 20v-5h5', 'M4 15h5v5'] },
  close: { l: ['M6 6l12 12', 'M18 6L6 18'] },
  external: { l: ['M14 4h6v6', 'M20 4l-8.5 8.5', 'M18 14v6H4V6h6'] },
  search: { l: ['M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M15.4 15.4L20 20'] },
  menu: { l: ['M4 7h16', 'M4 12h16', 'M9 17h11'] },
  chevronDown: { l: ['M6 9l6 6 6-6'] },
  chevronUp: { l: ['M6 15l6-6 6 6'] },
  retry: { l: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4v4.2h-4.2'] },
  tap: { l: ['M12 3v3', 'M5.6 5.6l2.1 2.1', 'M18.4 5.6l-2.1 2.1'], f: ['M12 9.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z'] },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, className = 'mf-icon'): SVGSVGElement {
  const def: IconDef = ICONS[name];
  const svg = s('svg', { viewBox: '0 0 24 24', class: className, 'aria-hidden': 'true', focusable: 'false' });
  for (const d of def.f ?? []) svg.append(s('path', { d, fill: 'currentColor' }));
  for (const d of def.l ?? []) {
    svg.append(
      s('path', {
        d,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.7',
        'stroke-linecap': 'square',
        'stroke-linejoin': 'miter',
      }),
    );
  }
  return svg;
}

/** Replaces the first icon inside `host` (or appends one). */
export function swapIcon(host: Element, name: IconName): void {
  const next = icon(name);
  const current = host.querySelector('svg.mf-icon');
  if (current) current.replaceWith(next);
  else host.prepend(next);
}
