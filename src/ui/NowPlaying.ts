import { CONFIG } from '../config/config';
import { formatTrackNumber, getCollection } from '../config/tracks';
import type { AudioFeatures, PlaybackState, ResolvedTrack, SyncStatus, TrackChange } from '../core/types';
import type { UIContext } from './context';
import { Scope, animate, applyLang, ease, formatArtist, h, nextFrame, run } from './dom';
import { icon } from './icons';
import { MiniVisualizer } from './MiniVisualizer';
import { sourceIndicator, unplayableReason } from './status';

export type TitleTier = 'l' | 'm' | 's' | 'xs';

/** Size tier by visible length so long titles wrap gracefully instead of overflowing. */
export function titleTier(title: string): TitleTier {
  const length = [...title].length;
  if (length <= 14) return 'l';
  if (length <= 26) return 'm';
  if (length <= 40) return 's';
  return 'xs';
}

/** Right zone: NOW PLAYING / number, title, artist, collection, source & sync, mini meter. */
export class NowPlaying {
  readonly el: HTMLElement;
  readonly signalChip: HTMLButtonElement;
  private readonly num: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly title: HTMLElement;
  private readonly beam: HTMLElement;
  private readonly artist: HTMLElement;
  private readonly collection: HTMLElement;
  private readonly collectionLabel: HTMLElement;
  private readonly collectionNote: HTMLElement;
  private readonly source: HTMLElement;
  private readonly sourceText: HTMLElement;
  private readonly syncButton: HTMLButtonElement;
  private readonly syncText: HTMLElement;
  private readonly alert: HTMLElement;
  private readonly alertText: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly external: HTMLAnchorElement;
  private readonly visualizer = new MiniVisualizer();
  private readonly scope = new Scope();
  private running: Animation[] = [];
  private trackId = -1;

  constructor(
    private readonly ctx: UIContext,
    onSignalChip: () => void,
  ) {
    this.num = h('span', { class: 'mf-np__num' }, '000');
    this.signalChip = h(
      'button',
      { type: 'button', class: 'mf-np__chip', 'aria-label': 'Scroll to the signal window (video source)' },
      'SIGNAL',
      icon('chevronDown'),
    );
    this.title = h('h2', { class: 'mf-np__title', id: 'mf-np-title' });
    this.stage = h('div', { class: 'mf-np__stage' }, this.title);
    this.beam = h('span', { class: 'mf-np__beam', 'aria-hidden': 'true' });
    this.artist = h('p', { class: 'mf-np__artist' });
    this.collectionLabel = h('span', { class: 'mf-np__collection-label' });
    this.collectionNote = h('span', { class: 'mf-np__collection-note', lang: 'ja' });
    this.collection = h('p', { class: 'mf-np__collection' }, this.collectionLabel, this.collectionNote);

    this.sourceText = h('span', { class: 'mf-indicator__text' });
    this.source = h('p', { class: 'mf-indicator mf-indicator--source' }, h('i', { class: 'mf-indicator__mark', 'aria-hidden': 'true' }), this.sourceText);
    this.syncText = h('span', { class: 'mf-indicator__text' });
    this.syncButton = h(
      'button',
      { type: 'button', class: 'mf-indicator mf-indicator--sync', 'aria-keyshortcuts': 'S' },
      h('i', { class: 'mf-indicator__mark', 'aria-hidden': 'true' }),
      this.syncText,
      h('span', { class: 'mf-sr-only' }, ' — audio sync settings'),
    );
    ctx.bindPanelOpener('sync', this.syncButton);

    this.alertText = h('p', { class: 'mf-np__alert-text' });
    this.retry = h('button', { type: 'button', class: 'mf-textbtn', hidden: true }, icon('retry'), 'RETRY');
    this.external = h(
      'a',
      { class: 'mf-textbtn', target: '_blank', rel: 'noopener noreferrer', hidden: true },
      'OPEN ON YOUTUBE',
      icon('external'),
    );
    this.alert = h(
      'div',
      { class: 'mf-np__alert', role: 'status', hidden: true },
      this.alertText,
      h('div', { class: 'mf-np__alert-actions' }, this.retry, this.external),
    );

    this.el = h(
      'section',
      { class: 'mf-np', 'aria-labelledby': 'mf-np-title' },
      h(
        'div',
        { class: 'mf-np__head' },
        h('span', { class: 'mf-np__label' }, 'NOW PLAYING'),
        h('span', { class: 'mf-np__slash', 'aria-hidden': 'true' }, '/'),
        this.num,
        this.signalChip,
      ),
      this.stage,
      this.beam,
      this.artist,
      this.collection,
      h('div', { class: 'mf-np__status' }, this.source, this.syncButton),
      this.alert,
      h('div', { class: 'mf-np__meter' }, h('span', { class: 'mf-micro mf-np__meter-label', 'aria-hidden': 'true' }, 'LEVEL'), this.visualizer.el),
    );

    this.scope.listen(this.signalChip, 'click', onSignalChip);
    this.scope.listen(this.syncButton, 'click', () => ctx.togglePanel('sync', this.syncButton));
    this.scope.listen(this.retry, 'click', () => run(ctx.player.retry(), 'retry'));

    const { bus, player, sync } = ctx;
    this.scope.add(bus.on('player:state', (state) => this.applyStatus(state)));
    this.scope.add(
      bus.on('source:update', (source) => {
        if (source.trackId === this.trackId) this.applyStatus(player.getState());
      }),
    );
    this.scope.add(bus.on('sync:status', (status) => this.applySync(status)));
    this.scope.add(bus.on('visual:mode', () => nextFrame(() => this.visualizer.refreshColors())));

    this.render(player.getCurrentTrack());
    this.applyStatus(player.getState());
    this.applySync(sync.getStatus());
    nextFrame(() => this.visualizer.refreshColors());
  }

  update(features: Readonly<AudioFeatures>, dt: number): void {
    this.visualizer.draw(features, dt);
  }

  /** Typographic track change: old title out fast, new one in with direction, artist shortly after. */
  transition(change: TrackChange, reduced: boolean): void {
    this.cancelAnimations();
    const ghost = this.title.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id');
    ghost.classList.add('is-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    this.stage.append(ghost);
    this.render(change.track);
    this.applyStatus(this.ctx.player.getState());

    const featured = change.transition === 'featured';
    const total = featured ? CONFIG.transitions.featuredMs : CONFIG.transitions.standardMs;
    const dir = change.direction === -1 ? -1 : 1;
    const anims: Array<Animation | null> = [];

    if (reduced) {
      anims.push(animate(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }));
      for (const el of [this.title, this.artist, this.collection]) {
        anims.push(animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 80, fill: 'backwards' }));
      }
    } else {
      const exitMs = Math.round(total * 0.26);
      const enterAt = Math.round(total * 0.24);
      const enterMs = Math.round(total * 0.58);
      const from = dir > 0 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
      const to = dir > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)';
      anims.push(
        animate(
          ghost,
          [
            { transform: 'none', opacity: 1, clipPath: 'inset(0 0 0 0)' },
            { transform: `translateX(${-dir * 10}%) skewX(-16deg)`, opacity: 0, clipPath: to },
          ],
          { duration: exitMs, easing: ease('exit'), fill: 'forwards' },
        ),
        animate(
          this.title,
          [
            { transform: `translateX(${dir * 14}%) skewX(-16deg)`, opacity: 0, clipPath: from },
            { transform: 'none', opacity: 1, clipPath: 'inset(0 0 0 0)' },
          ],
          { duration: enterMs, delay: enterAt, easing: ease('snap'), fill: 'backwards' },
        ),
        animate(
          this.artist,
          [
            { transform: `translateX(${dir * 24}px)`, opacity: 0, clipPath: from },
            { transform: 'none', opacity: 1, clipPath: 'inset(0 0 0 0)' },
          ],
          { duration: Math.round(enterMs * 0.8), delay: enterAt + 120, easing: ease('snap'), fill: 'backwards' },
        ),
        animate(this.collection, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
          duration: 320,
          delay: enterAt + 200,
          easing: ease('snap'),
          fill: 'backwards',
        }),
        animate(this.num, [{ transform: 'perspective(240px) rotateX(-90deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
          duration: 360,
          delay: Math.round(enterAt * 0.6),
          easing: ease('elastic'),
          fill: 'backwards',
        }),
        animate(
          this.beam,
          [
            { transform: 'scaleX(0)', opacity: 1, transformOrigin: dir > 0 ? 'left' : 'right' },
            { transform: 'scaleX(1)', opacity: 1, offset: 0.55, transformOrigin: dir > 0 ? 'left' : 'right' },
            { transform: 'scaleX(1)', opacity: 0.4, transformOrigin: dir > 0 ? 'left' : 'right' },
          ],
          { duration: total, delay: enterAt, easing: ease('snap'), fill: 'backwards' },
        ),
      );
    }

    this.running = anims.filter((a): a is Animation => a !== null);
    const ghostExit = anims[0];
    if (ghostExit) ghostExit.finished.then(() => ghost.remove(), () => ghost.remove());
    else ghost.remove();
  }

  dispose(): void {
    this.cancelAnimations();
    this.scope.dispose();
    this.visualizer.dispose();
  }

  private cancelAnimations(): void {
    for (const anim of this.running) anim.cancel();
    this.running = [];
    for (const ghost of this.stage.querySelectorAll('.is-ghost')) ghost.remove();
  }

  private render(track: ResolvedTrack): void {
    this.trackId = track.id;
    const collection = getCollection(track.collection);
    this.num.textContent = formatTrackNumber(track.id);
    this.title.textContent = track.title;
    this.title.dataset.tier = titleTier(track.title);
    applyLang(this.title, track.title);
    this.artist.textContent = formatArtist(track.artist);
    this.collectionLabel.textContent = collection.label;
    this.collectionNote.textContent = collection.note;
  }

  private applyStatus(state: Readonly<PlaybackState>): void {
    const track = this.ctx.player.getCurrentTrack();
    const playable = this.ctx.player.isPlayable(track.id);
    const indicator = sourceIndicator(state, track, playable);
    this.sourceText.textContent = indicator.text;
    this.source.dataset.tone = indicator.tone;

    const externalUrl = state.error?.externalUrl ?? track.source.externalUrl;
    let message: string | null = null;
    let canRetry = false;
    if (state.status === 'ERROR') {
      message = state.error?.message ?? 'Playback failed.';
      canRetry = true;
    } else if (state.status === 'SOURCE_UNAVAILABLE' || !playable) {
      message = state.error?.message ?? unplayableReason(track, playable);
    }
    this.alert.hidden = message === null;
    this.alert.dataset.tone = canRetry ? 'error' : 'warn';
    this.alertText.textContent = message ?? '';
    this.retry.hidden = !canRetry;
    this.external.hidden = message === null || !externalUrl;
    if (externalUrl) this.external.href = externalUrl;
    else this.external.removeAttribute('href');
  }

  private applySync(status: SyncStatus): void {
    this.syncText.textContent = status.label;
    this.syncButton.dataset.real = String(status.real);
  }
}
