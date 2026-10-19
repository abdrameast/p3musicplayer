// Self-hosted fonts (SIL Open Font License). The CSS files declare
// unicode-range subsets, so Noto Sans JP / DotGothic16 only download the
// Japanese slices actually rendered.
// Latin includes the catalogue's French accents (Ça, é…). Other scripts use
// the Japanese family below; avoid shipping unused Devanagari/Cyrillic faces.
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/michroma/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/dotgothic16/400.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/700.css';

const FONT_TIMEOUT_MS = 2500;

/** Fonts the LCD canvas and display titles depend on; the sample text pulls the right subsets. */
const CRITICAL_FONTS: ReadonlyArray<readonly [font: string, sample: string]> = [
  ['400 16px "DotGothic16"', 'BURN MY DREAD 04:35 VOL キミの記憶 やすらぎ'],
  ['400 16px "IBM Plex Mono"', 'NOW PLAYING 046 04:35'],
  ['700 16px "Rajdhani"', 'FULL MOON FULL LIFE'],
];

function loadCriticalFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  const loads = CRITICAL_FONTS.map(([font, sample]) => document.fonts.load(font, sample).catch(() => []));
  return Promise.all(loads);
}

/**
 * Resolves when the LCD / display fonts are usable, or after 2.5 s so a slow
 * network never holds the walkman screen hostage. Never rejects.
 */
export const fontsReady: Promise<unknown> = Promise.race([
  loadCriticalFonts(),
  new Promise<void>((resolve) => setTimeout(resolve, FONT_TIMEOUT_MS)),
]);
