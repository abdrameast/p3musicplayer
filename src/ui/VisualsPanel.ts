import { MODES } from '../config/config';
import type { QualityProfile, QualitySetting, VisualMode } from '../core/types';
import type { UIContext } from './context';
import { sectionTitle, segmented, type Segmented } from './controls';
import { Scope, h } from './dom';

const QUALITY_OPTIONS: ReadonlyArray<readonly [QualitySetting, string]> = [
  ['auto', 'AUTO'],
  ['high', 'HIGH'],
  ['medium', 'MEDIUM'],
  ['low', 'LOW'],
];

/** VISUALS · 映像 — atmosphere mode, rendering quality, walkman pose. */
export class VisualsPanel {
  readonly el: HTMLElement;
  private readonly cards = new Map<VisualMode, HTMLButtonElement>();
  private readonly quality: Segmented<QualitySetting>;
  private readonly qualityHint: HTMLElement;
  private readonly scope = new Scope();
  private profile: QualityProfile | null;

  constructor(
    private readonly ctx: UIContext,
    getProfile: () => QualityProfile | null,
  ) {
    const { prefs, bus, sounds } = ctx;
    this.profile = getProfile();

    const modes = h('div', { class: 'mf-modes', role: 'group', 'aria-label': 'Visual mode' });
    for (const mode of Object.keys(MODES) as VisualMode[]) {
      const spec = MODES[mode];
      const swatch = h('span', { class: 'mf-mode__swatch', 'aria-hidden': 'true' });
      swatch.style.setProperty('--sw-top', spec.skyTop);
      swatch.style.setProperty('--sw-mid', spec.skyMid);
      swatch.style.setProperty('--sw-bottom', spec.skyBottom);
      swatch.style.setProperty('--sw-halo', spec.haloColor);
      const card = h(
        'button',
        { type: 'button', class: 'mf-mode', 'aria-pressed': 'false', 'data-mode': mode },
        swatch,
        h(
          'span',
          { class: 'mf-mode__text' },
          h('span', { class: 'mf-mode__name' }, spec.label, h('span', { class: 'mf-mode__jp', lang: 'ja' }, spec.kanji)),
          h('span', { class: 'mf-mode__desc' }, spec.description),
        ),
      );
      this.cards.set(mode, card);
      modes.append(card);
      this.scope.listen(card, 'click', () => {
        ctx.setVisualMode(mode);
        sounds.play('select');
      });
    }

    this.quality = segmented('Rendering quality', QUALITY_OPTIONS, prefs.get().quality, (quality) => {
      prefs.set({ quality });
      sounds.play('toggle');
    });
    this.scope.add(() => this.quality.dispose());
    this.qualityHint = h('p', { class: 'mf-hint' });

    const reset = h('button', { type: 'button', class: 'mf-textbtn mf-textbtn--block' }, 'RESET WALKMAN POSE');
    this.scope.listen(reset, 'click', () => {
      bus.emit('walkman:reset-pose', undefined);
      sounds.play('select');
    });

    this.el = h(
      'div',
      { class: 'mf-visuals' },
      h('section', { class: 'mf-section' }, sectionTitle('ATMOSPHERE', '雰囲気'), modes),
      h('section', { class: 'mf-section' }, sectionTitle('QUALITY', '画質'), this.quality.el, this.qualityHint),
      h(
        'section',
        { class: 'mf-section' },
        sectionTitle('WALKMAN', '本体'),
        h('p', { class: 'mf-hint' }, 'Drag the walkman to turn it. Reset springs it back to its presentation pose.'),
        reset,
      ),
    );

    this.scope.add(bus.on('visual:mode', (mode) => this.applyMode(mode)));
    this.scope.add(
      bus.on('quality:profile', (profile) => {
        this.profile = profile;
        this.applyQuality();
      }),
    );
    this.scope.add(prefs.subscribe((next) => {
      this.applyMode(next.visualMode);
      this.applyQuality();
    }));
    this.applyMode(prefs.get().visualMode);
    this.applyQuality();
  }

  dispose(): void {
    this.scope.dispose();
  }

  private applyMode(mode: VisualMode): void {
    for (const [id, card] of this.cards) card.setAttribute('aria-pressed', String(id === mode));
  }

  private applyQuality(): void {
    const setting = this.ctx.prefs.get().quality;
    this.quality.set(setting);
    const current = this.profile ? this.profile.toUpperCase() : null;
    this.qualityHint.textContent =
      setting === 'auto'
        ? `AUTO adapts to your device's frame rate${current ? ` · currently ${current}` : ''}.`
        : `Fixed at ${setting.toUpperCase()}. Lower settings reduce particles, water and resolution — never the walkman.`;
  }
}
