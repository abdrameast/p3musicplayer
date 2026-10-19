import { CONFIG } from '../config/config';
import type { MotionPreference, Preferences, SourcePreference } from '../core/types';
import type { UIContext } from './context';
import { sectionTitle, segmented, switchControl } from './controls';
import { Scope, h } from './dom';
import { icon } from './icons';
import { SHORTCUT_HELP } from './KeyboardShortcuts';

const MOTION_OPTIONS: ReadonlyArray<readonly [MotionPreference, string]> = [
  ['system', 'SYSTEM'],
  ['reduce', 'REDUCED'],
  ['full', 'FULL'],
];

const SOURCE_OPTIONS: ReadonlyArray<readonly [SourcePreference, string]> = [
  ['auto', 'AUTO'],
  ['youtube', 'YOUTUBE'],
  ['licensed', 'LICENSED'],
];

const SOURCE_HINT: Readonly<Record<SourcePreference, string>> = {
  auto: 'Uses the best verified source available for each track.',
  youtube: 'Always the official YouTube embed (visible in the signal window).',
  licensed: 'Only licensed audio files. None are bundled by default, so most tracks become unavailable.',
};

const CONFIRM_MS = 4000;

/** SETTINGS · 設定 — interface, motion, source preference, shortcuts, about. */
export class SettingsPanel {
  readonly el: HTMLElement;
  private readonly scope = new Scope();
  private readonly sourceHint: HTMLElement;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: UIContext) {
    const { prefs, sounds, bus, player } = ctx;
    const initial = prefs.get();

    const uiSounds = switchControl('Interface sounds', initial.uiSounds, (on) => {
      prefs.set({ uiSounds: on });
      if (on) sounds.play('toggle');
    });
    const motion = segmented('Motion', MOTION_OPTIONS, initial.motion, (value) => {
      prefs.set({ motion: value });
      sounds.play('toggle');
    });
    const source = segmented('Source preference', SOURCE_OPTIONS, initial.sourcePreference, (value) => {
      prefs.set({ sourcePreference: value });
      sounds.play('toggle');
    });
    this.sourceHint = h('p', { class: 'mf-hint' }, SOURCE_HINT[initial.sourcePreference]);

    const shortcuts = h('dl', { class: 'mf-keys' });
    for (const [keys, action] of SHORTCUT_HELP) {
      shortcuts.append(h('div', { class: 'mf-keys__row' }, h('dt', null, h('kbd', null, keys)), h('dd', null, action)));
    }

    const reset = h('button', { type: 'button', class: 'mf-textbtn mf-textbtn--block' }, 'RESET PREFERENCES');
    this.scope.listen(reset, 'click', () => {
      if (!reset.classList.contains('is-confirming')) {
        reset.classList.add('is-confirming');
        reset.textContent = 'CONFIRM RESET';
        this.confirmTimer = setTimeout(() => {
          reset.classList.remove('is-confirming');
          reset.textContent = 'RESET PREFERENCES';
        }, CONFIRM_MS);
        return;
      }
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      reset.classList.remove('is-confirming');
      reset.textContent = 'RESET PREFERENCES';
      prefs.reset();
      const defaults = prefs.get();
      // Playback and scene state mirror preferences; bring them back in line with the defaults.
      player.setVolume(defaults.volume);
      player.setMuted(defaults.muted);
      player.setRepeat(defaults.repeat);
      bus.emit('visual:mode', defaults.visualMode);
      ctx.notify({ id: 'prefs-reset', level: 'info', message: 'Preferences reset to defaults.' });
    });

    const playlist = h(
      'a',
      { class: 'mf-textbtn', href: CONFIG.youtube.playlistUrl, target: '_blank', rel: 'noopener noreferrer' },
      'YOUTUBE PLAYLIST',
      icon('external'),
    );

    this.el = h(
      'div',
      { class: 'mf-settings' },
      h('section', { class: 'mf-section' }, sectionTitle('INTERFACE', '操作'), uiSounds.el),
      h(
        'section',
        { class: 'mf-section' },
        sectionTitle('MOTION', '動き'),
        motion.el,
        h('p', { class: 'mf-hint' }, 'REDUCED removes camera breathing, sweeps and large movements; transitions become fades.'),
      ),
      h('section', { class: 'mf-section' }, sectionTitle('SOURCE', '音源'), source.el, this.sourceHint),
      h('section', { class: 'mf-section' }, sectionTitle('KEYBOARD', '鍵盤'), shortcuts),
      h('section', { class: 'mf-section' }, sectionTitle('RESET', '初期化'), reset),
      h(
        'section',
        { class: 'mf-section mf-about' },
        sectionTitle('ABOUT', '情報'),
        h('p', { class: 'mf-about__notice' }, CONFIG.app.unofficialNotice),
        h(
          'ul',
          { class: 'mf-about__credits' },
          h('li', null, 'Music © its respective rights holders, played through YouTube’s official embedded player.'),
          h('li', null, 'Fonts: Rajdhani, Space Grotesk, Michroma, IBM Plex Mono, DotGothic16, Noto Sans JP — SIL Open Font License.'),
          h('li', null, 'Built with three.js, Web Audio and the YouTube IFrame Player API.'),
        ),
        playlist,
      ),
    );

    this.scope.add(() => {
      uiSounds.dispose();
      motion.dispose();
      source.dispose();
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
    });
    this.scope.add(
      prefs.subscribe((next: Preferences) => {
        uiSounds.set(next.uiSounds);
        motion.set(next.motion);
        source.set(next.sourcePreference);
        this.sourceHint.textContent = SOURCE_HINT[next.sourcePreference];
      }),
    );
  }

  dispose(): void {
    this.scope.dispose();
  }
}
