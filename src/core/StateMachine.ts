import type { PlaybackStatus } from './types';

/**
 * Finite state machine with an explicit transition table. Invalid transitions
 * are rejected (returning false) so that a stale or out-of-order provider
 * event can never put the player into an impossible state.
 */
export class StateMachine<S extends string> {
  private current: S;
  private readonly listeners = new Set<(to: S, from: S) => void>();

  constructor(
    initial: S,
    private readonly table: Readonly<Record<S, readonly S[]>>,
  ) {
    this.current = initial;
  }

  get state(): S {
    return this.current;
  }

  can(to: S): boolean {
    return to === this.current || this.table[this.current].includes(to);
  }

  /** Returns true when the machine is in `to` after the call. */
  transition(to: S): boolean {
    if (to === this.current) return true;
    if (!this.table[this.current].includes(to)) return false;
    const from = this.current;
    this.current = to;
    for (const listener of [...this.listeners]) listener(to, from);
    return true;
  }

  onChange(listener: (to: S, from: S) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const ANY_LOADED: readonly PlaybackStatus[] = [
  'READY',
  'PLAYING',
  'PAUSED',
  'BUFFERING',
  'ENDED',
  'SOURCE_UNAVAILABLE',
  'AUTOPLAY_BLOCKED',
  'ERROR',
];

/**
 * Player transitions. Every state can reach SOURCE_UNAVAILABLE / ERROR /
 * READY (a new selection) so selection changes are always possible; only
 * INITIALIZING is one-way.
 */
export const PLAYBACK_TRANSITIONS: Readonly<Record<PlaybackStatus, readonly PlaybackStatus[]>> = {
  INITIALIZING: ['READY', 'SOURCE_UNAVAILABLE', 'ERROR', 'BUFFERING', 'PLAYING', 'AUTOPLAY_BLOCKED'],
  READY: ['PLAYING', 'BUFFERING', 'PAUSED', 'SOURCE_UNAVAILABLE', 'AUTOPLAY_BLOCKED', 'ERROR', 'ENDED'],
  PLAYING: ['PAUSED', 'BUFFERING', 'ENDED', 'READY', 'SOURCE_UNAVAILABLE', 'ERROR', 'AUTOPLAY_BLOCKED'],
  PAUSED: ['PLAYING', 'BUFFERING', 'READY', 'ENDED', 'SOURCE_UNAVAILABLE', 'ERROR', 'AUTOPLAY_BLOCKED'],
  BUFFERING: ['PLAYING', 'PAUSED', 'READY', 'ENDED', 'SOURCE_UNAVAILABLE', 'ERROR', 'AUTOPLAY_BLOCKED'],
  ENDED: ['PLAYING', 'BUFFERING', 'READY', 'PAUSED', 'SOURCE_UNAVAILABLE', 'ERROR', 'AUTOPLAY_BLOCKED'],
  SOURCE_UNAVAILABLE: ANY_LOADED.filter((s) => s !== 'SOURCE_UNAVAILABLE'),
  AUTOPLAY_BLOCKED: ANY_LOADED.filter((s) => s !== 'AUTOPLAY_BLOCKED'),
  ERROR: ANY_LOADED.filter((s) => s !== 'ERROR'),
};

export function createPlaybackMachine(): StateMachine<PlaybackStatus> {
  return new StateMachine<PlaybackStatus>('INITIALIZING', PLAYBACK_TRANSITIONS);
}
