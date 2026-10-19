import type { CollectionInfo, Track, TrackCollection } from '../core/types';

/**
 * Canonical catalogue — the single source of truth for the 67 titles.
 *
 * Titles and artists are kept exactly as provided by the project brief
 * (Japanese preserved, no translation, no track numbers). Playable sources
 * are resolved separately (src/config/source-map.ts + src/sources/*): a
 * YouTube playlist index is never assumed to equal a canonical id.
 */

export const COLLECTIONS: readonly CollectionInfo[] = [
  { id: 'ORIGINAL', label: 'PERSONA 3', short: 'Original', note: '2006 · 原作' },
  { id: 'FES', label: 'PERSONA 3 FES', short: 'FES', note: '2007 · フェス' },
  { id: 'PORTABLE', label: 'PERSONA 3 PORTABLE', short: 'Portable', note: '2009 · ポータブル' },
  { id: 'PERSONA_Q', label: 'PERSONA Q', short: 'Persona Q', note: '2014 · 迷宮' },
  { id: 'MOVIES', label: 'PERSONA 3 THE MOVIE', short: 'Movies', note: '2013–2016 · 劇場版' },
  { id: 'DANCING', label: 'PERSONA 3: DANCING IN MOONLIGHT', short: 'Dancing', note: '2018 · 月夜' },
  { id: 'PERSONA_Q2', label: 'PERSONA Q2', short: 'Persona Q2', note: '2018 · 新世界' },
  { id: 'RELOAD', label: 'PERSONA 3 RELOAD', short: 'Reload', note: '2024 · リロード' },
  { id: 'P5X', label: 'PERSONA 5: THE PHANTOM X — ARRANGEMENTS', short: 'P5X', note: 'ARRANGE · 編曲' },
];

const t = (id: number, title: string, artist: string, collection: TrackCollection): Track => ({
  id,
  title,
  artist,
  collection,
});

export const TRACKS: readonly Track[] = Object.freeze([
  // PERSONA 3 — ORIGINAL
  t(1, 'Burn My Dread (Full)', 'Yumi Kawamura', 'ORIGINAL'),
  t(2, 'Want To Be Close', 'Yumi Kawamura', 'ORIGINAL'),
  t(3, 'やすらぎ (Peace)', 'Yumi Kawamura', 'ORIGINAL'),
  t(4, "When The Moon's Reaching Out Stars", 'Yumi Kawamura', 'ORIGINAL'),
  t(5, 'Mass Destruction', 'Yumi Kawamura & Lotus Juice', 'ORIGINAL'),
  t(6, 'Deep Breath Deep Breath', 'Yumi Kawamura & Lotus Juice', 'ORIGINAL'),
  t(7, 'Changing Seasons', 'Yumi Kawamura', 'ORIGINAL'),
  t(8, 'Burn My Dread -Last Battle-', 'Lotus Juice', 'ORIGINAL'),
  t(9, 'Memories of You (キミの記憶)', 'Yumi Kawamura', 'ORIGINAL'),

  // PERSONA 3 FES
  t(10, 'P3 FES', 'Yumi Kawamura & Lotus Juice', 'FES'),
  t(11, 'Mass Destruction (P3 FES)', 'Yumi Kawamura & Lotus Juice', 'FES'),
  t(12, 'Brand New Days', 'Yumi Kawamura', 'FES'),

  // PERSONA 3 PORTABLE
  t(13, 'Soul Phrase', 'Shuhei Kita', 'PORTABLE'),
  t(14, 'A Way of Life', 'Mayumi Fujita', 'PORTABLE'),
  t(15, 'Time', 'Mayumi Fujita', 'PORTABLE'),
  t(16, 'Wiping All Out', 'Mayumi Fujita & Lotus Juice', 'PORTABLE'),
  t(17, 'Way of Life -Deep inside my mind Remix-', 'Mayumi Fujita', 'PORTABLE'),

  // PERSONA Q
  t(18, 'Maze of Life', 'Yumi Kawamura & Shihoko Hirata', 'PERSONA_Q'),
  t(19, 'Light the Fire Up in the Night - KAGEJIKAN -', 'Yumi Kawamura & Lotus Juice', 'PERSONA_Q'),
  t(20, 'Laser Beam', 'Yumi Kawamura & Lotus Juice', 'PERSONA_Q'),
  t(21, 'Paulownia Mall - In The Labyrinth -', 'Shoji Meguro', 'PERSONA_Q'),
  t(22, 'Changing Me', 'Yumi Kawamura & Shihoko Hirata', 'PERSONA_Q'),

  // PERSONA 3 MOVIES
  t(23, 'Burn My Dread (Movie Ver.)', 'Yumi Kawamura', 'MOVIES'),
  t(24, 'More Than One Heart', 'Yumi Kawamura', 'MOVIES'),
  t(25, 'Fate Is In Our Hands', 'Lotus Juice', 'MOVIES'),
  t(26, 'Mass Destruction - Lotus Juice Remix -', 'Lotus Juice & Yumi Kawamura', 'MOVIES'),
  t(27, 'Deep Breath, Deep Breath - Lotus Juice Remix -', 'Lotus Juice & Yumi Kawamura', 'MOVIES'),
  t(28, 'One Single Word', 'Shoji Meguro', 'MOVIES'),
  t(29, 'One Hand, One Heartbeat', 'Yumi Kawamura', 'MOVIES'),
  t(30, 'Light In Starless Sky', 'Yumi Kawamura', 'MOVIES'),
  t(31, 'One Determination', 'Shoji Meguro', 'MOVIES'),
  t(32, 'Sound of the Beast', 'Shoji Meguro', 'MOVIES'),
  t(33, 'Storm for a Butterfly', 'Shoji Meguro', 'MOVIES'),
  t(34, 'My Testimony', 'Yumi Kawamura', 'MOVIES'),
  t(35, 'Self Redemption', 'Yumi Kawamura', 'MOVIES'),
  t(36, 'Burn My Dread - Last Battle (Future Arrange) -', 'Lotus Juice', 'MOVIES'),
  t(37, 'Memories of You (Remix)', 'Yumi Kawamura', 'MOVIES'),

  // PERSONA 3: DANCING IN MOONLIGHT
  t(38, 'Our Moment', 'Yumi Kawamura', 'DANCING'),
  t(39, 'Moonlight Serendipity', 'Yumi Kawamura & Lotus Juice', 'DANCING'),

  // PERSONA Q2
  t(40, 'ROAD LESS TAKEN', 'Yumi Kawamura, Shihoko Hirata, Lyn Inaizumi & Lotus Juice', 'PERSONA_Q2'),
  t(41, 'Cinematic Tale', 'Yumi Kawamura', 'PERSONA_Q2'),
  t(42, 'Nothing is Promised', 'Lotus Juice', 'PERSONA_Q2'),
  t(43, 'Wait and See', 'Yumi Kawamura', 'PERSONA_Q2'),
  t(44, 'Pull the Trigger', 'Mayumi Fujita & Lotus Juice', 'PERSONA_Q2'),
  t(45, 'colorful world', 'Yumi Kawamura', 'PERSONA_Q2'),

  // PERSONA 3 RELOAD
  t(46, 'Full Moon Full Life', 'Azumi Takahashi & Lotus Juice', 'RELOAD'),
  t(47, 'Want To Be Close -Reload-', 'Azumi Takahashi', 'RELOAD'),
  t(48, 'やすらぎ -Reload-', 'Azumi Takahashi', 'RELOAD'),
  t(49, "When The Moon's Reaching Out Stars -Reload-", 'Azumi Takahashi', 'RELOAD'),
  t(50, '巌戸台分寮 -Reload- (Iwatodai Dorm)', 'Lotus Juice', 'RELOAD'),
  t(51, 'Mass Destruction -Reload-', 'Azumi Takahashi & Lotus Juice', 'RELOAD'),
  t(52, "It's Going Down Now", 'Azumi Takahashi & Lotus Juice', 'RELOAD'),
  t(53, 'Color Your Night', 'Azumi Takahashi & Lotus Juice', 'RELOAD'),
  t(54, 'Deep Breath Deep Breath -Reload-', 'Azumi Takahashi & Lotus Juice', 'RELOAD'),
  t(55, 'ポロニアンモール -Reload- (Paulownia Mall)', 'Azumi Takahashi', 'RELOAD'),
  t(56, 'The Meaning of Armbands', 'Lotus Juice', 'RELOAD'),
  t(57, 'Changing Seasons -Reload-', 'Azumi Takahashi', 'RELOAD'),
  t(58, 'Burn My Dread -Last Battle Reload-', 'Lotus Juice', 'RELOAD'),
  t(59, 'キミの記憶 -Reload- (Memories of You)', 'Azumi Takahashi', 'RELOAD'),
  t(60, 'Burn My Dread -Reload-', 'Azumi Takahashi', 'RELOAD'),
  t(61, 'Disconnected', 'Azumi Takahashi', 'RELOAD'),
  t(62, 'Mass Destruction -P3fes Reload-', 'Azumi Takahashi & Lotus Juice', 'RELOAD'),
  t(63, "Don't", 'Azumi Takahashi & Lotus Juice', 'RELOAD'),
  t(64, 'Brand New Days -Reload-', 'Azumi Takahashi', 'RELOAD'),
  t(65, 'P3 fes -Reload-', 'Azumi Takahashi & Lotus Juice', 'RELOAD'),

  // PERSONA 5: THE PHANTOM X — ARRANGEMENTS
  t(66, 'Ça va barder maintenant -Arrangement P5X-', 'Persona 5: The Phantom X Sound Team', 'P5X'),
  t(67, 'Wiping All Out -P5X arrange-', 'Persona 5: The Phantom X Sound Team', 'P5X'),
]);

export const TRACK_COUNT = 67;

export function getCollection(id: TrackCollection): CollectionInfo {
  const info = COLLECTIONS.find((c) => c.id === id);
  if (!info) throw new Error(`Unknown collection ${id}`);
  return info;
}

export function getTrack(id: number): Track | undefined {
  return TRACKS[id - 1]?.id === id ? TRACKS[id - 1] : TRACKS.find((track) => track.id === id);
}

/** Zero-padded canonical number, e.g. 46 → "046". */
export function formatTrackNumber(id: number): string {
  return String(id).padStart(3, '0');
}
