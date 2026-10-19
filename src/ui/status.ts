import type { PlaybackState, PlaybackStatus, ResolvedTrack, SourceStatus, TrackSourceState } from '../core/types';

/** Shared wording for playback / source states so every HUD surface says the same thing. */

export const SOURCE_BADGE: Readonly<Record<Exclude<SourceStatus, 'READY'>, string>> = {
  UNMAPPED: 'NOT MAPPED',
  UNAVAILABLE: 'UNAVAILABLE',
  EMBED_BLOCKED: 'EMBED BLOCKED',
  ERROR: 'ERROR',
};

/** Badge for a tracklist row, or null when the track can be played. */
export function sourceBadge(source: TrackSourceState, playable: boolean): string | null {
  if (source.status !== 'READY') return SOURCE_BADGE[source.status];
  // READY on a provider the current source preference excludes.
  return playable ? null : 'EXCLUDED';
}

export function unplayableReason(track: ResolvedTrack, playable: boolean): string {
  if (track.source.reason) return track.source.reason;
  switch (track.source.status) {
    case 'UNMAPPED':
      return 'No verified source is mapped to this title yet.';
    case 'UNAVAILABLE':
      return 'The mapped video is no longer available.';
    case 'EMBED_BLOCKED':
      return 'The rights holder does not allow this video to be embedded.';
    case 'ERROR':
      return 'The source failed to load.';
    case 'READY':
      return playable ? '' : 'Your source preference (Settings → Source) excludes this track’s only source.';
  }
}

export const STATUS_LABEL: Readonly<Record<PlaybackStatus, string>> = {
  INITIALIZING: 'PREPARING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  BUFFERING: 'BUFFERING',
  ENDED: 'ENDED',
  SOURCE_UNAVAILABLE: 'NO SOURCE',
  AUTOPLAY_BLOCKED: 'PRESS PLAY',
  ERROR: 'ERROR',
};

/** True when the transport should offer "Pause". */
export function isPlayingLike(status: PlaybackStatus): boolean {
  return status === 'PLAYING' || status === 'BUFFERING';
}

export type Tone = 'ok' | 'pending' | 'warn' | 'error';

export interface SourceIndicator {
  text: string;
  tone: Tone;
}

export function sourceIndicator(state: Readonly<PlaybackState>, track: ResolvedTrack, playable: boolean): SourceIndicator {
  if (track.source.status !== 'READY') {
    return { text: `SOURCE · ${SOURCE_BADGE[track.source.status]}`, tone: track.source.status === 'ERROR' ? 'error' : 'warn' };
  }
  if (!playable) return { text: 'SOURCE · EXCLUDED', tone: 'warn' };
  if (state.status === 'INITIALIZING') return { text: 'SIGNAL · PREPARING', tone: 'pending' };
  if (state.status === 'ERROR') return { text: 'SOURCE · ERROR', tone: 'error' };
  const kind = state.trackId === track.id && state.provider ? state.provider : track.source.kind;
  if (kind === 'licensed') return { text: 'SOURCE · LICENSED AUDIO', tone: 'ok' };
  if (kind === 'youtube') return { text: 'SOURCE · YOUTUBE EMBED', tone: 'ok' };
  return { text: 'SOURCE · UNAVAILABLE', tone: 'warn' };
}
