import { COLLECTIONS, TRACK_COUNT, formatTrackNumber, getCollection } from '../config/tracks';
import type { CollectionFilter, Preferences, ResolvedTrack } from '../core/types';
import type { UIContext } from './context';
import { Scope, applyLang, formatArtist, h, uid } from './dom';
import { icon } from './icons';
import { NATIVE_KEYS_ATTR } from './KeyboardShortcuts';
import { createSearchIndex, filterTracks, type SearchEntry } from './search';
import { sourceBadge, unplayableReason } from './status';

interface Row {
  track: ResolvedTrack;
  li: HTMLLIElement;
  button: HTMLButtonElement;
  badge: HTMLElement;
  explain: HTMLElement;
  explainText: HTMLElement;
  explainLink: HTMLAnchorElement;
}

const FILTERS: ReadonlyArray<readonly [CollectionFilter, string]> = [
  ['ALL', 'All'],
  ...COLLECTIONS.map((c) => [c.id, c.short] as const),
];

/**
 * The 67 canonical titles, always listed (playable or not). Rows are built
 * once; search, filters, the active row and availability badges only toggle
 * attributes, so scroll position and focus survive track changes.
 */
export class Tracklist {
  readonly el: HTMLElement;
  private readonly rows = new Map<number, Row>();
  private readonly index: SearchEntry[];
  private readonly search: HTMLInputElement;
  private readonly list: HTMLOListElement;
  private readonly count: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly emptyQuery: HTMLElement;
  private readonly chips = new Map<CollectionFilter, HTMLButtonElement>();
  private readonly scope = new Scope();
  private filter: CollectionFilter;
  private activeId = -1;
  private explainedId: number | null = null;
  private openedOnce = false;
  private sourcePreference: Preferences['sourcePreference'];

  constructor(private readonly ctx: UIContext) {
    const { player, prefs, bus } = ctx;
    this.index = createSearchIndex(player.tracks);
    this.filter = prefs.get().tracklistFilter;
    this.sourcePreference = prefs.get().sourcePreference;
    const listId = uid('mf-tracklist');

    this.search = h('input', {
      type: 'search',
      class: 'mf-search__input',
      placeholder: 'Title, artist, version, 番号…',
      'aria-label': 'Search tracks',
      'aria-controls': listId,
      autocomplete: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
    });
    const chipGroup = h('div', { class: 'mf-chips', role: 'group', 'aria-label': 'Filter by collection' });
    for (const [id, label] of FILTERS) {
      const chip = h('button', { type: 'button', class: 'mf-chip', 'aria-pressed': 'false', 'data-filter': id }, label);
      this.chips.set(id, chip);
      chipGroup.append(chip);
      this.scope.listen(chip, 'click', () => this.setFilter(id, true));
    }
    this.count = h('p', { class: 'mf-tracklist__count', 'aria-live': 'polite' });
    this.emptyQuery = h('span', { class: 'mf-tracklist__empty-query' });
    const clear = h('button', { type: 'button', class: 'mf-textbtn' }, 'CLEAR SEARCH');
    this.empty = h(
      'div',
      { class: 'mf-tracklist__empty', hidden: true },
      h('p', { class: 'mf-tracklist__empty-title' }, 'NO SIGNAL'),
      h('p', { class: 'mf-tracklist__empty-text' }, 'No track matches ', this.emptyQuery, '.'),
      clear,
    );
    this.list = h('ol', { class: 'mf-tracklist__list', id: listId, [NATIVE_KEYS_ATTR]: '' });
    for (const track of player.tracks) this.list.append(this.buildRow(track).li);

    this.el = h(
      'div',
      { class: 'mf-tracklist' },
      h('div', { class: 'mf-search' }, icon('search'), this.search),
      chipGroup,
      this.count,
      h('div', { class: 'mf-tracklist__scroller' }, this.list, this.empty),
    );

    this.scope.listen(this.search, 'input', () => this.applyFilter());
    this.scope.listen<KeyboardEvent>(this.search, 'keydown', (event) => {
      if (event.key === 'Escape' && this.search.value) {
        event.preventDefault();
        event.stopPropagation();
        this.search.value = '';
        this.applyFilter();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.visibleButtons()[0]?.focus();
      }
    });
    this.scope.listen(clear, 'click', () => {
      this.search.value = '';
      this.applyFilter();
      this.search.focus();
    });
    this.scope.listen<KeyboardEvent>(this.list, 'keydown', (event) => this.onListKey(event));

    this.scope.add(bus.on('player:track', (change) => this.setActive(change.track.id)));
    this.scope.add(bus.on('player:state', (state) => this.list.classList.toggle('is-playing', state.status === 'PLAYING')));
    this.scope.add(
      bus.on('source:update', (source) => {
        const row = this.rows.get(source.trackId);
        if (row) this.refreshRow(row);
      }),
    );
    this.scope.add(
      prefs.subscribe((next) => {
        if (next.tracklistFilter !== this.filter) this.setFilter(next.tracklistFilter, false);
        if (next.sourcePreference !== this.sourcePreference) {
          this.sourcePreference = next.sourcePreference;
          // The App forwards the preference to the player in its own subscriber; read playability after it.
          setTimeout(() => this.refreshAll(), 0);
        }
      }),
    );

    this.setFilter(this.filter, false);
    this.setActive(player.getCurrentTrack().id);
    this.list.classList.toggle('is-playing', player.getState().status === 'PLAYING');
  }

  initialFocus(compact: boolean): HTMLElement {
    // On phones, focusing the field would pop the keyboard over the list.
    if (compact) {
      const active = this.rows.get(this.activeId);
      return active && !active.li.hidden ? active.button : this.visibleButtons()[0] ?? this.search;
    }
    return this.search;
  }

  onOpen(): void {
    if (this.openedOnce) return;
    this.openedOnce = true;
    const active = this.rows.get(this.activeId)?.li;
    if (active && !active.hidden) active.scrollIntoView?.({ block: 'center' });
  }

  dispose(): void {
    this.scope.dispose();
  }

  private buildRow(track: ResolvedTrack): Row {
    const collection = getCollection(track.collection);
    const title = h('span', { class: 'mf-row__title' }, track.title);
    applyLang(title, track.title);
    const badge = h('span', { class: 'mf-row__badge' });
    const button = h(
      'button',
      { type: 'button', class: 'mf-row__btn' },
      h('span', { class: 'mf-row__num' }, formatTrackNumber(track.id)),
      h(
        'span',
        { class: 'mf-row__main' },
        title,
        h(
          'span',
          { class: 'mf-row__meta' },
          h('span', { class: 'mf-row__artist' }, formatArtist(track.artist)),
          h('span', { class: 'mf-row__collection' }, collection.short),
        ),
      ),
      h('span', { class: 'mf-row__eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      badge,
      h('span', { class: 'mf-sr-only mf-row__current' }, ', current track'),
    );
    const explainText = h('span', { class: 'mf-row__explain-text' });
    const explainLink = h(
      'a',
      { class: 'mf-textbtn', target: '_blank', rel: 'noopener noreferrer', hidden: true },
      'OPEN ON YOUTUBE',
      icon('external'),
    );
    const explain = h('div', { class: 'mf-row__explain', hidden: true }, explainText, explainLink);
    const li = h('li', { class: 'mf-row', 'data-id': track.id }, button, explain);
    const row: Row = { track, li, button, badge, explain, explainText, explainLink };
    this.rows.set(track.id, row);
    this.scope.listen(button, 'click', () => this.activate(row));
    this.refreshRow(row);
    return row;
  }

  private refreshRow(row: Row): void {
    const playable = this.ctx.player.isPlayable(row.track.id);
    const badge = sourceBadge(row.track.source, playable);
    row.badge.textContent = badge ?? '';
    row.badge.hidden = badge === null;
    row.li.classList.toggle('is-unplayable', !playable);
    if (this.explainedId === row.track.id) {
      if (playable) this.hideExplanation();
      else this.showExplanation(row, null);
    }
  }

  private refreshAll(): void {
    for (const row of this.rows.values()) this.refreshRow(row);
  }

  private async activate(row: Row): Promise<void> {
    const { player, sounds } = this.ctx;
    const id = row.track.id;
    if (!player.isPlayable(id)) {
      this.showExplanation(row, null);
      this.notifyUnplayable(row, null);
      return;
    }
    this.hideExplanation();
    sounds.play('select');
    try {
      const result = await player.select(id, { autoplay: true });
      if (!result.ok) {
        this.showExplanation(row, result.reason ?? null);
        this.notifyUnplayable(row, result.reason ?? null);
      } else if (this.ctx.isCompact()) {
        this.ctx.closePanels();
      }
    } catch (error) {
      console.warn('[ui] select failed', error);
    }
  }

  private showExplanation(row: Row, reason: string | null): void {
    if (this.explainedId !== null && this.explainedId !== row.track.id) this.hideExplanation();
    this.explainedId = row.track.id;
    const playable = this.ctx.player.isPlayable(row.track.id);
    row.explainText.textContent = reason ?? unplayableReason(row.track, playable);
    const url = row.track.source.externalUrl;
    row.explainLink.hidden = !url;
    if (url) row.explainLink.href = url;
    row.explain.hidden = false;
  }

  private hideExplanation(): void {
    if (this.explainedId === null) return;
    const row = this.rows.get(this.explainedId);
    if (row) row.explain.hidden = true;
    this.explainedId = null;
  }

  private notifyUnplayable(row: Row, reason: string | null): void {
    const url = row.track.source.externalUrl;
    this.ctx.notify({
      id: `track-unplayable-${row.track.id}`,
      level: 'warn',
      message: `${formatTrackNumber(row.track.id)} · ${row.track.title} can’t be played here`,
      detail: reason ?? unplayableReason(row.track, false),
      action: url ? { label: 'Open on YouTube ↗', href: url } : undefined,
    });
  }

  private setActive(id: number): void {
    if (id === this.activeId) return;
    const previous = this.rows.get(this.activeId);
    if (previous) {
      previous.li.classList.remove('is-active');
      previous.button.removeAttribute('aria-current');
    }
    this.activeId = id;
    const row = this.rows.get(id);
    if (!row) return;
    row.li.classList.add('is-active');
    row.button.setAttribute('aria-current', 'true');
  }

  private setFilter(filter: CollectionFilter, persist: boolean): void {
    this.filter = filter;
    for (const [id, chip] of this.chips) chip.setAttribute('aria-pressed', String(id === filter));
    if (persist) {
      this.ctx.prefs.set({ tracklistFilter: filter });
      this.ctx.sounds.play('select');
    }
    this.applyFilter();
  }

  private applyFilter(): void {
    const ids = new Set(filterTracks(this.index, this.search.value, this.filter));
    for (const [id, row] of this.rows) row.li.hidden = !ids.has(id);
    const query = this.search.value.trim();
    this.count.textContent =
      ids.size === TRACK_COUNT ? `${TRACK_COUNT} TRACKS` : `${ids.size} OF ${TRACK_COUNT} · ${query ? 'MATCHING' : 'IN FILTER'}`;
    this.empty.hidden = ids.size > 0;
    this.emptyQuery.textContent = query ? `“${query}”` : 'this filter';
  }

  private visibleButtons(): HTMLButtonElement[] {
    const buttons: HTMLButtonElement[] = [];
    for (const row of this.rows.values()) if (!row.li.hidden) buttons.push(row.button);
    return buttons;
  }

  private onListKey(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = this.visibleButtons();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1 || buttons.length === 0) return;
    event.preventDefault();
    let next = current;
    if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
    else if (event.key === 'ArrowUp') next = current - 1;
    else if (event.key === 'Home') next = 0;
    else next = buttons.length - 1;
    if (next < 0) this.search.focus();
    else buttons[next].focus();
  }
}
