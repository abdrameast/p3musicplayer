import { CONFIG } from '../config/config';
import type { Track, TrackCollection } from '../core/types';

/**
 * Title matcher used to SUGGEST mappings between videos observed on YouTube
 * and canonical tracks. It never decides alone: only confident, unambiguous
 * suggestions (≥ CONFIG.sources.minConfidence) are flagged `accepted`, and a
 * version marker disagreement ("-Reload-", "P3 FES", "Remix", "Last Battle",
 * "P5X", covers, loops…) always sinks the score so one version can never be
 * mistaken for another.
 */

export interface ObservedVideo {
  videoId?: string;
  title: string;
  channel?: string;
}

export interface MatchScore {
  /** Raw score; 1 = same title and version. May slightly exceed 1 with context bonuses. */
  score: number;
  reasons: string[];
}

export interface MatchCandidate {
  observed: ObservedVideo;
  /** Best canonical track, or null when nothing scored above zero. */
  trackId: number | null;
  /** 0..1 */
  confidence: number;
  /** Another track scored within AMBIGUITY_MARGIN of the best one. */
  ambiguous: boolean;
  /** Another observed video claims the same track with a better score. */
  duplicate: boolean;
  /** Safe to apply automatically: confident, unambiguous, not a duplicate. */
  accepted: boolean;
  runnerUp: { trackId: number; confidence: number } | null;
  reasons: string[];
}

export const AMBIGUITY_MARGIN = 0.05;

/**
 * Localised titles of the same recording observed on YouTube. Track 66's
 * canonical title is the French localisation YouTube shows for the video
 * whose English title is "It's Going Down Now -P5X arrange-".
 */
export const TITLE_ALIASES: Readonly<Record<number, readonly string[]>> = {
  66: ["It's Going Down Now -P5X arrange-"],
};

// ───────────────────────────────────────────────────────────── normalising ──

const DASHES = /[‐-―−﹘﹣－]/g;
const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;
/** Latin combining marks only — Japanese (han)dakuten (U+3099/U+309A) must survive. */
const LATIN_MARKS = /[̀-ͯ]/g;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]/u;
const JAPANESE_RUN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]+/gu;

function baseNormalize(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(LATIN_MARKS, '')
    .normalize('NFC')
    .replace(DASHES, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ContextPattern {
  collection: TrackCollection;
  pattern: RegExp;
  /** Generic "Persona 3" mentions are weak evidence of the original game. */
  weak?: boolean;
}

/** Series / album phrases: removed from titles, kept as context evidence. Most specific first. */
const CONTEXT_PATTERNS: readonly ContextPattern[] = [
  { collection: 'RELOAD', pattern: /persona\s*3\s*reload(?:\s*(?:original\s*)?(?:ost|soundtrack))?/g },
  { collection: 'FES', pattern: /persona\s*3\s*fes(?:\s*(?:ost|soundtrack))?/g },
  { collection: 'PORTABLE', pattern: /persona\s*3\s*portable|\bp3p\b/g },
  { collection: 'PERSONA_Q2', pattern: /persona\s*q2(?:\s*:?\s*new\s*cinema\s*labyrinth)?/g },
  { collection: 'PERSONA_Q', pattern: /persona\s*q(?:\s*:?\s*shadow\s*of\s*the\s*labyrinth)?\b/g },
  {
    collection: 'MOVIES',
    pattern:
      /persona\s*3\s*the\s*movie(?:\s*(?:#|no\.?\s*)\d)?(?:\s*:?\s*(?:spring\s*of\s*birth|midsummer\s*knight'?s\s*dream|falling\s*down|winter\s*of\s*rebirth))?/g,
  },
  { collection: 'DANCING', pattern: /persona\s*3\s*:?\s*dancing\s*(?:in\s*)?moon\s*light|\bp3d\b/g },
  { collection: 'P5X', pattern: /persona\s*5\s*:?\s*the\s*phantom\s*x/g },
  { collection: 'ORIGINAL', pattern: /persona\s*3(?:\s*(?:original\s*)?(?:ost|soundtrack))?/g, weak: true },
];

/** Multi-word version phrases folded into a single marker token before tokenising. */
const MARKER_PHRASES: ReadonlyArray<[RegExp, string]> = [
  [/[([]\s*full\s*[)\]]/g, ' fullver '],
  [/\bfull[\s-]*(?:ver(?:sion)?|size)\b\.?/g, ' fullver '],
  [/\bmovie[\s-]*ver(?:sion)?\b\.?/g, ' moviever '],
  [/\bp3\s*fes\b/g, ' p3fes '],
  [/\blast\s*battle\b/g, ' lastbattle '],
  [/\barrange(?:ment|d)?\b|\barr\./g, ' arrange '],
  [/\btv[\s-]*(?:size|ver(?:sion)?)\b/g, ' tvsize '],
  [/\b(?:\d+\s*hours?|1\s*hr)\b/g, ' extended '],
  [/\b8[\s-]*bit\b/g, ' 8bit '],
];

interface MarkerInfo {
  marker: string;
  /** Soft markers ("Full", "Full Version") only slightly lower a score. */
  soft?: boolean;
}

const MARKER_TOKENS: Readonly<Record<string, MarkerInfo>> = {
  reload: { marker: 'reload' },
  p3fes: { marker: 'fes' },
  fes: { marker: 'fes' },
  lastbattle: { marker: 'lastbattle' },
  remix: { marker: 'remix' },
  moviever: { marker: 'movie' },
  movie: { marker: 'movie' },
  p5x: { marker: 'p5x' },
  arrange: { marker: 'arrange' },
  fullver: { marker: 'full', soft: true },
  // Never canonical: an observed video carrying one of these is another recording.
  instrumental: { marker: 'instrumental' },
  inst: { marker: 'instrumental' },
  karaoke: { marker: 'karaoke' },
  cover: { marker: 'cover' },
  piano: { marker: 'piano' },
  acoustic: { marker: 'acoustic' },
  live: { marker: 'live' },
  extended: { marker: 'extended' },
  loop: { marker: 'extended' },
  nightcore: { marker: 'nightcore' },
  slowed: { marker: 'slowed' },
  reverb: { marker: 'slowed' },
  '8bit': { marker: '8bit' },
  tvsize: { marker: 'tvsize' },
  orchestra: { marker: 'orchestral' },
  orchestral: { marker: 'orchestral' },
};

/** Version markers implied by the collection a track (or an observed video) belongs to. */
const COLLECTION_MARKER: Partial<Record<TrackCollection, string>> = {
  FES: 'fes',
  MOVIES: 'movie',
  P5X: 'p5x',
  RELOAD: 'reload',
};

const NOISE_WORDS = new Set([
  'lyrics', 'lyric', 'hd', 'hq', '4k', '1080p', '720p', 'official', 'audio', 'video', 'music', 'mv', 'pv',
  'ost', 'soundtrack', 'original', 'kanji', 'romaji', 'english', 'eng', 'sub', 'subs', 'subbed', 'subtitles',
  'opening', 'ending', 'version', 'ver', 'topic',
]);

const ARTICLES = new Set(['a', 'an', 'the']);

function removeContext(text: string): { text: string; context: ContextPattern | null } {
  let context: ContextPattern | null = null;
  let out = text;
  for (const entry of CONTEXT_PATTERNS) {
    entry.pattern.lastIndex = 0;
    if (entry.pattern.test(out)) {
      context ??= entry;
      entry.pattern.lastIndex = 0;
      out = out.replace(entry.pattern, ' ');
    }
  }
  return { text: out, context };
}

/** Drops (…)/[…] groups made only of noise words, such as "[Lyrics]" or "(kanji/romaji/english)". */
function removeNoiseGroups(text: string): string {
  return text
    .replace(/[([](?:feat|ft)\.?[^)\]]*[)\]]/g, ' ')
    .replace(/[([【「]([^)\]】」]*)[)\]】」]/g, (_group, inner: string) => {
      const words = inner.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      return words.length > 0 && words.every((word) => NOISE_WORDS.has(word)) ? ' ' : ` ${inner} `;
    });
}

function cleanTitle(input: string): { text: string; context: ContextPattern | null } {
  let text = baseNormalize(input);
  // Markers first: "(Full)" must be recognised before brackets are unwrapped.
  for (const [pattern, replacement] of MARKER_PHRASES) text = text.replace(pattern, replacement);
  text = removeNoiseGroups(text);
  const stripped = removeContext(text);
  text = stripped.text;
  // Leading album track numbers: "07 - Mass Destruction", "01. P3 FES".
  text = text.replace(/^[\s\-:|.,/]*(?:track\s*)?\d{1,3}\s*[-.:)|]\s*/, ' ');
  text = text
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.has(word))
    .join(' ');
  return { text, context: stripped.context };
}

/**
 * Comparison key of a title: NFKC, lowercase, Latin diacritics removed,
 * dashes/quotes unified, noise ([Lyrics], "Persona 3 OST -", album track
 * numbers, "| Persona 5: The Phantom X"…) removed, punctuation dropped.
 * Version markers are kept (folded into single tokens such as "p3fes").
 */
export function normalizeTitle(title: string): string {
  return cleanTitle(title).text;
}

/** Channel key: "Yumi Kawamura - Topic" → "yumi kawamura". */
export function normalizeChannel(channel: string): string {
  return baseNormalize(channel)
    .replace(/\s*-\s*topic$/, '')
    .replace(/vevo$/, '')
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────────────────────────────────────────── tokenising ──

interface TitleShape {
  /** Content tokens (markers and articles removed); Japanese runs become character bigrams. */
  core: string[];
  markers: Map<string, MarkerInfo>;
}

function japaneseBigrams(run: string): string[] {
  const chars = [...run];
  if (chars.length < 2) return [`jp:${run}`];
  const grams: string[] = [];
  for (let i = 0; i < chars.length - 1; i += 1) grams.push(`jp:${chars[i]}${chars[i + 1]}`);
  return grams;
}

function tokenize(normalized: string): string[] {
  const tokens: string[] = [];
  for (const word of normalized.split(' ')) {
    if (!word) continue;
    if (!JAPANESE.test(word)) {
      tokens.push(word);
      continue;
    }
    const latin = word.replace(JAPANESE_RUN, ' ').trim();
    for (const run of word.match(JAPANESE_RUN) ?? []) tokens.push(...japaneseBigrams(run));
    if (latin) tokens.push(...latin.split(' '));
  }
  return tokens;
}

function shapeOf(normalized: string): TitleShape {
  const markers = new Map<string, MarkerInfo>();
  const core: string[] = [];
  const all = tokenize(normalized);
  for (const token of all) {
    const marker = MARKER_TOKENS[token];
    if (marker) markers.set(marker.marker, marker);
    else if (!ARTICLES.has(token)) core.push(token);
  }
  // Titles made only of markers ("P3 FES") compare on their full token list.
  return { core: core.length > 0 ? core : all, markers };
}

interface TrackProfile {
  track: Track;
  variants: string[][];
  markers: Map<string, MarkerInfo>;
  artists: string[][];
}

function artistNames(artist: string): string[][] {
  return baseNormalize(artist)
    .split(/\s*(?:&|×|,|\band\b)\s*/)
    .map((name) => name.replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().split(/\s+/).filter(Boolean))
    .filter((parts) => parts.length > 0);
}

/**
 * Canonical titles mixing Japanese and an English gloss ("巌戸台分寮 -Reload- (Iwatodai Dorm)")
 * are compared on their Japanese part and, separately, on their Latin part.
 */
function buildProfile(track: Track, aliases: readonly string[]): TrackProfile {
  const full = shapeOf(normalizeTitle(track.title));
  const variants = [full.core];
  if (JAPANESE.test(track.title)) {
    const japaneseOnly = (track.title.match(JAPANESE_RUN) ?? []).join(' ');
    const latinOnly = track.title.replace(JAPANESE_RUN, ' ');
    for (const part of [japaneseOnly, latinOnly]) {
      const shape = shapeOf(normalizeTitle(part));
      if (shape.core.length > 0) variants.push(shape.core);
    }
  }
  for (const alias of aliases) variants.push(shapeOf(normalizeTitle(alias)).core);
  return { track, variants, markers: full.markers, artists: artistNames(track.artist) };
}

// ──────────────────────────────────────────────────────────────── scoring ──

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Recall-weighted token overlap: missing canonical words cost more than extra observed words. */
function tokenSimilarity(canonical: readonly string[], observed: readonly string[]): number {
  if (canonical.length === 0 || observed.length === 0) return 0;
  const pool = [...observed];
  let matched = 0;
  for (const token of canonical) {
    let index = pool.indexOf(token);
    let weight = 1;
    if (index < 0 && token.length >= 5 && !token.startsWith('jp:')) {
      index = pool.findIndex((candidate) => candidate.length >= 4 && editDistanceAtMostOne(token, candidate));
      weight = 0.85;
    }
    if (index >= 0) {
      matched += weight;
      pool.splice(index, 1);
    }
  }
  return 0.7 * (matched / canonical.length) + 0.3 * (matched / observed.length);
}

const HARD_MARKER_PENALTY = 0.35;
const SOFT_MARKER_PENALTY = 0.05;
const CONTEXT_BONUS = 0.04;
const WEAK_CONTEXT_BONUS = 0.02;
const CONTEXT_PENALTY = 0.12;
const WEAK_CONTEXT_PENALTY = 0.06;
const ARTIST_BONUS = 0.03;

interface ObservedProfile {
  shape: TitleShape;
  context: ContextPattern | null;
  channel: string;
}

function observedProfile(observed: ObservedVideo): ObservedProfile {
  const cleaned = cleanTitle(observed.title);
  return { shape: shapeOf(cleaned.text), context: cleaned.context, channel: normalizeChannel(observed.channel ?? '') };
}

function containsName(tokens: readonly string[], name: readonly string[]): boolean {
  return name.every((part) => tokens.includes(part));
}

function scoreProfiles(profile: TrackProfile, observed: ObservedProfile): MatchScore {
  const reasons: string[] = [];
  const { track } = profile;
  const canonicalTokens = new Set(profile.variants.flat());

  // Artist names in an observed title ("Yumi Kawamura - Want To Be Close") are not title words.
  let observedCore = observed.shape.core;
  let artistSeen = false;
  for (const name of profile.artists) {
    if (containsName(observedCore, name) && !name.every((part) => canonicalTokens.has(part))) {
      observedCore = observedCore.filter((token) => !name.includes(token));
      artistSeen = true;
    }
  }
  const channelTokens = observed.channel.split(' ');
  if (profile.artists.some((name) => containsName(channelTokens, name))) artistSeen = true;

  let base = 0;
  for (const variant of profile.variants) base = Math.max(base, tokenSimilarity(variant, observedCore));
  let score = base;
  reasons.push(`title similarity ${base.toFixed(2)}`);

  const contextMarker = observed.context ? COLLECTION_MARKER[observed.context.collection] : undefined;
  const collectionMarker = COLLECTION_MARKER[track.collection];

  for (const [marker, info] of profile.markers) {
    if (observed.shape.markers.has(marker) || marker === contextMarker) continue;
    score -= info.soft ? SOFT_MARKER_PENALTY : HARD_MARKER_PENALTY;
    reasons.push(`missing version marker "${marker}"`);
  }
  for (const [marker, info] of observed.shape.markers) {
    if (profile.markers.has(marker) || marker === collectionMarker) continue;
    score -= info.soft ? SOFT_MARKER_PENALTY : HARD_MARKER_PENALTY;
    reasons.push(`unexpected version marker "${marker}"`);
  }

  if (observed.context) {
    const weak = observed.context.weak === true;
    if (observed.context.collection === track.collection) {
      score += weak ? WEAK_CONTEXT_BONUS : CONTEXT_BONUS;
      reasons.push(`context agrees (${observed.context.collection})`);
    } else {
      score -= weak ? WEAK_CONTEXT_PENALTY : CONTEXT_PENALTY;
      reasons.push(`context ${observed.context.collection} ≠ ${track.collection}`);
    }
  }

  if (artistSeen) {
    score += ARTIST_BONUS;
    reasons.push('artist hint');
  }
  return { score, reasons };
}

const profileCache = new WeakMap<Track, TrackProfile>();

function profileFor(track: Track, aliases: Readonly<Record<number, readonly string[]>>): TrackProfile {
  if (aliases !== TITLE_ALIASES) return buildProfile(track, aliases[track.id] ?? []);
  let profile = profileCache.get(track);
  if (!profile) {
    profile = buildProfile(track, aliases[track.id] ?? []);
    profileCache.set(track, profile);
  }
  return profile;
}

/** Scores one observed video against one canonical track. */
export function scoreMatch(
  track: Track,
  observed: { title: string; channel?: string },
  aliases: Readonly<Record<number, readonly string[]>> = TITLE_ALIASES,
): MatchScore {
  return scoreProfiles(profileFor(track, aliases), observedProfile(observed));
}

export interface MatchOptions {
  minConfidence?: number;
  ambiguityMargin?: number;
  aliases?: Readonly<Record<number, readonly string[]>>;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Best canonical candidate for every observed video. Candidates below
 * `minConfidence`, ambiguous ones and duplicates are returned for review but
 * never `accepted`.
 */
export function matchObservedToCatalog(
  tracks: readonly Track[],
  observed: readonly ObservedVideo[],
  options: MatchOptions = {},
): MatchCandidate[] {
  const minConfidence = options.minConfidence ?? CONFIG.sources.minConfidence;
  const margin = options.ambiguityMargin ?? AMBIGUITY_MARGIN;
  const aliases = options.aliases ?? TITLE_ALIASES;
  const profiles = tracks.map((track) => profileFor(track, aliases));

  const scored = observed.map((video): { candidate: MatchCandidate; raw: number } => {
    const profile = observedProfile(video);
    let best: { trackId: number; score: MatchScore } | null = null;
    let second: { trackId: number; score: MatchScore } | null = null;
    for (const trackProfile of profiles) {
      const score = scoreProfiles(trackProfile, profile);
      if (!best || score.score > best.score.score) {
        second = best;
        best = { trackId: trackProfile.track.id, score };
      } else if (!second || score.score > second.score.score) {
        second = { trackId: trackProfile.track.id, score };
      }
    }
    if (!best || best.score.score <= 0) {
      const candidate: MatchCandidate = {
        observed: video,
        trackId: null,
        confidence: 0,
        ambiguous: false,
        duplicate: false,
        accepted: false,
        runnerUp: null,
        reasons: ['no plausible canonical title'],
      };
      return { candidate, raw: 0 };
    }
    const ambiguous = second !== null && best.score.score - second.score.score < margin;
    const confidence = clamp01(best.score.score);
    const reasons = [...best.score.reasons];
    if (ambiguous && second) reasons.push(`ambiguous with track ${second.trackId}`);
    const candidate: MatchCandidate = {
      observed: video,
      trackId: best.trackId,
      confidence,
      ambiguous,
      duplicate: false,
      accepted: !ambiguous && confidence >= minConfidence,
      runnerUp: second ? { trackId: second.trackId, confidence: clamp01(second.score.score) } : null,
      reasons,
    };
    return { candidate, raw: best.score.score };
  });

  // Two videos claiming the same track: only the clearly better one may be accepted.
  const byTrack = new Map<number, Array<{ candidate: MatchCandidate; raw: number }>>();
  for (const entry of scored) {
    const trackId = entry.candidate.trackId;
    if (trackId === null) continue;
    const list = byTrack.get(trackId) ?? [];
    list.push(entry);
    byTrack.set(trackId, list);
  }
  for (const list of byTrack.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => b.raw - a.raw);
    const tie = list[0].raw - list[1].raw < margin;
    for (const [index, { candidate }] of list.entries()) {
      if (index === 0 && !tie) continue;
      candidate.duplicate = true;
      candidate.accepted = false;
      candidate.reasons.push(`another video also matches track ${candidate.trackId}`);
    }
  }

  return scored.map((entry) => entry.candidate);
}
