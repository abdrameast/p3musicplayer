import { getCollection } from '../config/tracks';
import type { CollectionFilter, Track, TrackCollection } from '../core/types';

/**
 * Pure tracklist search. Text is folded so that case, width (ＲＥＬＯＡＤ),
 * Latin diacritics (Ça → ca), katakana/hiragana (キミ ≡ きみ) and punctuation
 * (It's ≡ its, -Reload- ≡ reload) never prevent a match.
 */

const COMBINING_LATIN_MARKS = /[̀-ͯ]/g;
const APOSTROPHES = /['’‘`´]/g;
const PUNCTUATION_OR_SYMBOL = /[\p{P}\p{S}]+/gu;
const KATAKANA = /[ァ-ヶ]/g;
const WHITESPACE = /\s+/g;

export function normalizeSearchText(input: string): string {
  return (
    input
      .normalize('NFKC')
      .toLowerCase()
      // Only Latin combining marks are stripped: removing every mark would
      // also strip kana dakuten (が → か) after NFD.
      .normalize('NFD')
      .replace(COMBINING_LATIN_MARKS, '')
      .normalize('NFC')
      .replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
      .replace(APOSTROPHES, '')
      .replace(PUNCTUATION_OR_SYMBOL, ' ')
      .replace(WHITESPACE, ' ')
      .trim()
  );
}

export function tokenize(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(' ') : [];
}

export interface SearchEntry {
  id: number;
  collection: TrackCollection;
  /** Folded title, artist and collection names. */
  text: string;
}

export function createSearchIndex(tracks: readonly Track[]): SearchEntry[] {
  return tracks.map((track) => {
    const collection = getCollection(track.collection);
    const text = normalizeSearchText(
      [track.title, track.artist, collection.label, collection.short, collection.note].join(' '),
    );
    return { id: track.id, collection: track.collection, text };
  });
}

const NUMERIC = /^\d+$/;

function tokenMatches(entry: SearchEntry, token: string): boolean {
  // "46" and "046" address canonical number 46 exactly instead of every id containing a 4.
  if (NUMERIC.test(token) && Number(token) === entry.id) return true;
  return entry.text.includes(token);
}

export function matchesEntry(entry: SearchEntry, tokens: readonly string[], filter: CollectionFilter): boolean {
  if (filter !== 'ALL' && entry.collection !== filter) return false;
  for (const token of tokens) if (!tokenMatches(entry, token)) return false;
  return true;
}

/** Ids (catalogue order) of entries in `filter` whose text contains every query token. */
export function filterTracks(index: readonly SearchEntry[], query: string, filter: CollectionFilter): number[] {
  const tokens = tokenize(query);
  const ids: number[] = [];
  for (const entry of index) if (matchesEntry(entry, tokens, filter)) ids.push(entry.id);
  return ids;
}
