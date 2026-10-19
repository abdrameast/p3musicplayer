import { TRACKS, getCollection, formatTrackNumber } from '../config/tracks';
import { SOURCE_MAP } from '../config/source-map';
import { SourceResolver } from '../sources/SourceResolver';
import { CONFIG } from '../config/config';
import { normalizeSearchText } from '../ui/search';
import type { SourceMapEntry, SourceOverridesFile } from '../core/types';

/** A dev-only manual review tool. Export never claims automatic audio verification. */
async function mount(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const resolver = new SourceResolver(TRACKS, SOURCE_MAP);
  await resolver.loadOverrides(CONFIG.sources.overridesUrl);
  const catalogue = document.querySelector<HTMLElement>('#catalogue')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  const edits: Array<{ row: HTMLElement; search: string; read(): SourceMapEntry | null }> = [];
  for (const track of resolver.getResolvedTracks()) {
    const row = document.createElement('article');
    const summary = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = `${formatTrackNumber(track.id)} / ${track.title}`;
    const info = document.createElement('small');
    info.textContent = `${track.artist} · ${getCollection(track.collection).label}`;
    const metadata = document.createElement('p');
    metadata.className = 'metadata';
    const verified = track.source.verification;
    metadata.textContent = verified ? `Observed: ${verified.observedTitle ?? '—'} · ${verified.observedChannel ?? '—'} · checked ${verified.checkedAt}` : 'No verified source.';
    const badge = document.createElement('div');
    badge.className = 'status';
    badge.textContent = `${track.source.status} · ${track.source.videoId ?? 'UNMAPPED'}`;
    summary.append(title, info, metadata, badge);
    const form = document.createElement('div');
    const videoLabel = document.createElement('label');
    videoLabel.textContent = 'YouTube video ID';
    const video = document.createElement('input');
    video.type = 'text'; video.value = track.source.videoId ?? ''; video.maxLength = 11;
    videoLabel.append(video);
    const observedLabel = document.createElement('label');
    observedLabel.textContent = 'Exact observed video title';
    const observed = document.createElement('input');
    observed.type = 'text'; observed.value = verified?.observedTitle ?? '';
    observedLabel.append(observed);
    const review = document.createElement('a');
    review.textContent = 'Open recording on YouTube ↗'; review.target = '_blank'; review.rel = 'noopener noreferrer';
    const updateLink = () => {
      const valid = /^[\w-]{11}$/.test(video.value.trim());
      review.hidden = !valid;
      if (valid) review.href = CONFIG.youtube.watchUrl(video.value.trim());
    };
    const confirmLabel = document.createElement('label');
    const confirmed = document.createElement('input');
    confirmed.type = 'checkbox';
    confirmLabel.append(confirmed, ' I checked this exact title and version; include this override.');
    const invalidate = () => { confirmed.checked = false; updateLink(); };
    video.addEventListener('input', invalidate); observed.addEventListener('input', invalidate);
    updateLink(); form.append(videoLabel, observedLabel, confirmLabel, review);
    row.append(summary, form); catalogue.append(row);
    edits.push({ row, search: normalizeSearchText(`${track.id} ${track.title} ${track.artist} ${track.collection}`), read: () => {
      if (!confirmed.checked) return null;
      if (!/^[\w-]{11}$/.test(video.value.trim()) || !observed.value.trim()) throw new Error(`Track ${track.id}: a valid video ID and observed title are required.`);
      return { trackId: track.id, videoId: video.value.trim(), verification: {
        method: 'manual-override', observedTitle: observed.value.trim(),
        checkedAt: new Date().toISOString().slice(0, 10), confidence: 1,
        note: 'Exact recording confirmed manually in the development source validator.',
      } };
    } });
  }
  status.textContent = `${TRACKS.length} canonical tracks. No changes selected.`;
  document.querySelector<HTMLInputElement>('#search')!.addEventListener('input', (event) => {
    const query = normalizeSearchText((event.target as HTMLInputElement).value);
    for (const edit of edits) edit.row.hidden = !edit.search.includes(query);
  });
  document.querySelector('#export')!.addEventListener('click', () => {
    try {
      const entries = edits.map((edit) => edit.read()).filter((entry): entry is SourceMapEntry => entry !== null);
      if (!entries.length) { status.textContent = 'Confirm at least one recording before exporting.'; return; }
      const file: SourceOverridesFile = { version: 1, generatedAt: new Date().toISOString(), entries };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' }));
      const download = document.createElement('a');
      download.href = url; download.download = 'source-overrides.json'; download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = `Exported ${entries.length} confirmed override(s). Save the file in public/ and reload the experience.`;
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  });
}
void mount();
