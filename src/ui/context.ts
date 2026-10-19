import type { EventBus } from '../core/EventBus';
import type { PreferencesStore } from '../core/Preferences';
import type { AppEvents, AudioSyncApi, Notice, PanelId, PlayerApi, VisualMode } from '../core/types';
import type { UISounds } from './UISounds';

/** Everything a HUD component may use; built once by UIManager. */
export interface UIContext {
  readonly bus: EventBus<AppEvents>;
  readonly player: PlayerApi;
  readonly sync: AudioSyncApi;
  readonly prefs: PreferencesStore;
  readonly sounds: UISounds;
  readonly isDev: boolean;
  isReducedMotion(): boolean;
  /** Mobile composition (< 768 px): sheets, popovers, stacked flow. */
  isCompact(): boolean;
  openPanel(id: PanelId, opener?: HTMLElement | null): void;
  togglePanel(id: PanelId, opener?: HTMLElement | null): void;
  closePanels(): void;
  /** Keeps aria-expanded / aria-controls of a panel opener in sync. */
  bindPanelOpener(id: PanelId, button: HTMLElement): void;
  notify(notice: Notice): void;
  setVisualMode(mode: VisualMode): void;
}
