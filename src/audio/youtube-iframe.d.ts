/**
 * Minimal typings for the subset of the official YouTube IFrame Player API
 * used by this project (https://developers.google.com/youtube/iframe_api_reference).
 */

export interface YTPlayerVars {
  autoplay?: 0 | 1;
  controls?: 0 | 1;
  playsinline?: 0 | 1;
  rel?: 0 | 1;
  iv_load_policy?: 1 | 3;
  enablejsapi?: 0 | 1;
  origin?: string;
}

export interface YTEvent {
  target: YTPlayer;
}

export interface YTDataEvent extends YTEvent {
  data: number;
}

export interface YTPlayerOptions {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  /** Embed host, e.g. the privacy-enhanced https://www.youtube-nocookie.com. */
  host?: string;
  playerVars?: YTPlayerVars;
  events?: {
    onReady?: (event: YTEvent) => void;
    onStateChange?: (event: YTDataEvent) => void;
    onError?: (event: YTDataEvent) => void;
    onAutoplayBlocked?: (event: YTEvent) => void;
  };
}

export interface YTPlayer {
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cuePlaylist(options: { list: string; listType?: 'playlist'; index?: number; startSeconds?: number }): void;
  /** Video ids of the cued playlist, in playlist order; null/empty until loaded. */
  getPlaylist(): string[] | null;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  getPlayerState(): number;
  getVideoUrl(): string;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

export interface YTNamespace {
  Player: new (element: HTMLElement | string, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}
