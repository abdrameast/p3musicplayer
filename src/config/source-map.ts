import type { SourceMapEntry } from '../core/types';

/**
 * Verified YouTube sources for the canonical catalogue.
 *
 * Established on 2026-10-19 from playlist PLWpIzCC1R3QbatqFaX4D9Op0lV9EEgybk:
 *  - every visible playlist entry (67) was read with its video id, title and
 *    channel, and compared by hand with the canonical title/version;
 *  - each id was probed through YouTube's public oEmbed endpoint, which
 *    returned HTTP 200 for all 67. Metadata availability is not a guarantee
 *    of playback in every browser or region.
 *
 * The playlist order happened to match the canonical order on that date, but
 * the mapping below is keyed by canonical id and was validated title by title —
 * it does not rely on playlist positions. Runtime player errors (removed,
 * private, embed-blocked, region-locked) still downgrade a track's status.
 *
 * Metadata and observed titles were rechecked with tools/verify-sources.mjs;
 * the report is in verification/sources.json. To correct a mapping, edit
 * public/source-overrides.json using the documented schema in README.md.
 */

const CHECKED_AT = '2026-10-19';

const e = (
  trackId: number,
  videoId: string,
  observedTitle: string,
  observedChannel: string,
  durationHint: number,
  confidence: number,
  note?: string,
): SourceMapEntry => ({
  trackId,
  videoId,
  durationHint,
  verification: {
    method: 'manual-title-match',
    observedTitle,
    observedChannel,
    checkedAt: CHECKED_AT,
    confidence,
    embedCheck: 'oembed-200',
    ...(note ? { note } : {}),
  },
});

export const SOURCE_MAP: readonly SourceMapEntry[] = Object.freeze([
  e(1, "bNvjrEoVoH0", "Persona 3 - Burn My Dread (Full) [Lyrics]", "Persona Addict", 279, 0.97, "Lyrics video; canonical full version."),
  e(2, "MymBg-mFaos", "Want To Be Close", "Yumi Kawamura - Topic", 153, 0.99),
  e(3, "VvvwVzA1z44", "やすらぎ", "Yumi Kawamura - Topic", 92, 0.97),
  e(4, "-kRJUKA_dFw", "Persona 3 OST - When The Moon's Reaching Out Stars", "MrKaiser891", 156, 0.99),
  e(5, "BjQHhDTbPCA", "Persona 3 OST - Mass Destruction", "MrKaiser891", 210, 0.99),
  e(6, "ioS7n1OyjG4", "Persona 3 OST - Deep Breath Deep Breath", "MrKaiser891", 141, 0.99),
  e(7, "wCbYkNmvi0w", "Persona 3 OST - Changing Seasons", "MrKaiser891", 180, 0.99),
  e(8, "-chq2BWWMhA", "Persona 3 OST - Burn My Dread -Last Battle-", "MrKaiser891", 228, 0.99),
  e(9, "JiKMzXwOH-E", "Persona 3 OST - Memories of You", "MrKaiser891", 370, 0.97),
  e(10, "5SLd2VaIvJw", "[Persona 3 FES] 01 - P3 FES", "DemonDaysxOST", 90, 0.99),
  e(11, "xZizrjvUpLk", "[Persona 3 FES] 07 - Mass Destruction", "DemonDaysxOST", 195, 0.99),
  e(12, "pNgFR_ttx2s", "[Persona 3 FES] 17 - Brand New Days", "DemonDaysxOST", 351, 0.99),
  e(13, "l4oWika0pGw", "Persona 3 Portable Opening - Soul Phrase: Full Version Lyrics (kanji/romaji/english)", "Reina", 286, 0.95, "Lyrics video of the full opening."),
  e(14, "Fd6MW-XhO5I", "Persona 3 Portable: A Way of Life", "RevolverJesusP3", 141, 0.99),
  e(15, "pfaPQibemwE", "Persona 3 Portable: Time", "RevolverJesusP3", 169, 0.99),
  e(16, "-iy47Q--EbU", "Persona 3 Portable: Wiping All Out", "RevolverJesusP3", 161, 0.99),
  e(17, "Q9-devZzZNk", "Persona 3 Portable: Way of Life -Deep inside my mind Remix-", "RevolverJesusP3", 230, 0.99),
  e(18, "B8vzOdkvZVA", "Maze of Life - Persona Q Shadow of the Labyrinth", "PSC", 265, 0.99),
  e(19, "X_yjT-y9G-k", "Light the Fire Up in the Night - KAGEJIKAN - Persona Q Shadow of the Labyrinth", "PSC", 161, 0.99),
  e(20, "yNFnrhdyHKY", "Laser Beam - Persona Q Shadow of the Labyrinth", "PSC", 195, 0.99),
  e(21, "QB1hnz55t8s", "Paulownia Mall - In The Labyrinth - Persona Q Shadow of the Labyrinth", "PSC", 99, 0.99),
  e(22, "wPdaf6WK8VI", "Changing Me - Persona Q Shadow of the Labyrinth", "PSC", 362, 0.99),
  e(23, "K-rm4aYdlsY", "Burn My Dread - Persona 3 The Movie", "PSC", 203, 0.95, "Observed title omits \"(Movie Ver.)\"; movie opening confirmed by title, channel series and playlist position."),
  e(24, "KLXWQa5_ydY", "More Than One Heart - Persona 3 The Movie", "PSC", 312, 0.99),
  e(25, "j6i6_LOvHVw", "Fate Is In Our Hands - Persona 3 The Movie", "PSC", 287, 0.99),
  e(26, "3DDwrvMAoIg", "Mass Destruction - Lotus Juice Remix - Persona 3 The Movie", "PSC", 266, 0.99),
  e(27, "CvP8wLuv8JM", "Deep Breath, Deep Breath - Lotus Juice Remix - Persona 3 The Movie", "PSC", 317, 0.99),
  e(28, "X2akN_jkDg4", "One Single Word - Persona 3 The Movie", "PSC", 77, 0.99),
  e(29, "6TXCG56RF5w", "One Hand, One Heartbeat - Persona 3 The Movie", "PSC", 269, 0.99),
  e(30, "9kJ03vfKb8w", "Light In Starless Sky - Persona 3 The Movie", "PSC", 251, 0.99),
  e(31, "0R97HafjodQ", "One Determination - Persona 3 The Movie", "PSC", 416, 0.99),
  e(32, "HYScn3onNfY", "Sound of the Beast - Persona 3 The Movie", "PSC", 183, 0.99),
  e(33, "S4V-ljEYkEc", "Storm for a Butterfly - Persona 3 The Movie", "PSC", 345, 0.99),
  e(34, "-lPhG0_VlyA", "My Testimony - Persona 3 The Movie", "PSC", 381, 0.99),
  e(35, "fqTmDX6B3OI", "Self Redemption - Persona 3 The Movie", "PSC", 250, 0.99),
  e(36, "FQ0llHxF3-A", "Burn My Dread - Last Battle (Future Arrange) - Persona 3 The Movie", "PSC", 307, 0.99),
  e(37, "t93WlTTCW8Q", "Memories of You (Remix) - Persona 3 The Movie", "PSC", 363, 0.99),
  e(38, "5VJO7oBwmRs", "Our Moment - Persona 3 Dancing In Moonlight", "PSC", 216, 0.99),
  e(39, "AtFL7ZRN2_Y", "Moonlight Serendipity - Persona 3 Dancing In Moonlight", "PSC", 234, 0.99),
  e(40, "PThXcY3sSQA", "ROAD LESS TAKEN", "Yumi Kawamura - Topic", 258, 0.99),
  e(41, "RdgbPfpCQKI", "Cinematic Tale", "Yumi Kawamura - Topic", 240, 0.99),
  e(42, "B0mSNsGSlBQ", "Nothing is Promised", "Lotus Juice - Topic", 183, 0.99),
  e(43, "YlmgojMHJ60", "Wait and See", "Yumi Kawamura - Topic", 203, 0.99),
  e(44, "ztRlRlyUGLM", "Pull the Trigger", "Release - Topic", 227, 0.99),
  e(45, "eNr-V4yAQPY", "colorful world", "Yumi Kawamura - Topic", 326, 0.99),
  e(46, "hWhgrA2dhrk", "Full Moon Full Life", "Azumi Takahashi - Topic", 294, 0.99),
  e(47, "jKYB5P5g2Uc", "Want To Be Close -Reload-", "Azumi Takahashi - Topic", 127, 0.99),
  e(48, "MqM-9sQ-eTE", "やすらぎ -Reload-", "Azumi Takahashi - Topic", 100, 0.99),
  e(49, "GZTp2JzcOJ0", "When The Moon's Reaching Out Stars -Reload-", "Azumi Takahashi - Topic", 208, 0.99),
  e(50, "Cj-FrFI0qnM", "巌戸台分寮 -Reload-", "Lotus Juice - Topic", 151, 0.99),
  e(51, "Q6q6pDC6Mas", "Mass Destruction -Reload-", "Lotus Juice - Topic", 186, 0.99),
  e(52, "2KuWjZD6PBA", "It's Going Down Now", "Azumi Takahashi - Topic", 187, 0.99),
  e(53, "j9Sn1nFGQQ8", "Color Your Night", "Lotus Juice - Topic", 228, 0.99),
  e(54, "I0LTJ4TrMNw", "Deep Breath Deep Breath -Reload-", "Lotus Juice - Topic", 176, 0.99),
  e(55, "HvyyJqMY-58", "ポロニアンモール -Reload-", "Azumi Takahashi - Topic", 76, 0.99),
  e(56, "Q0tHzOnnlSo", "The Meaning of Armbands", "Lotus Juice - Topic", 62, 0.99),
  e(57, "t9TdQCdtUeo", "Changing Seasons -Reload-", "Azumi Takahashi - Topic", 195, 0.99),
  e(58, "M8X_GrurJtg", "Burn My Dread -Last Battle Reload-", "Lotus Juice - Topic", 164, 0.99),
  e(59, "H5Qtu8fCycE", "キミの記憶 -Reload-", "Azumi Takahashi - Topic", 400, 0.99),
  e(60, "6IsGnEWA8AI", "Burn My Dread -Reload-", "Azumi Takahashi - Topic", 281, 0.99),
  e(61, "MeHWg2KwgVg", "Disconnected", "Azumi Takahashi - Topic", 287, 0.99),
  e(62, "lSb-DRbD2sE", "Mass Destruction -P3fes Reload-", "Lotus Juice - Topic", 189, 0.99),
  e(63, "dT5Ck6bXBu8", "Don't", "Azumi Takahashi - Topic", 166, 0.99),
  e(64, "bE3Z4WoiFwc", "Brand New Days -Reload-", "Azumi Takahashi - Topic", 353, 0.99),
  e(65, "N3g1gNE93bI", "P3 fes -Reload-", "Azumi Takahashi - Topic", 89, 0.99),
  e(66, "Al7g_uKgYPU", "It's Going Down Now -P5X arrange- | Persona 5: The Phantom X", "P5X Archives", 139, 0.95, "Observed localized titles: \"Ça va barder maintenant -Arrangement P5X-\" (fr page) / \"It's Going Down Now -P5X arrange-\" (oEmbed, en)."),
  e(67, "AY54QDIlHZM", "Wiping All Out -P5X arrange- | Persona 5: The Phantom X", "SMNFXCN", 158, 0.99),
]);
