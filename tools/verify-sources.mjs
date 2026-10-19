// Read-only metadata checks. Never downloads, extracts or stores any audio/video.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const source = await readFile(new URL('../src/config/source-map.ts', import.meta.url), 'utf8');
const entries = [...source.matchAll(/^\s*e\((\d+), ("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")/gm)]
  .map((match) => ({ trackId: Number(match[1]), videoId: JSON.parse(match[2]), mappedTitle: JSON.parse(match[3]) }));
if (entries.length !== 67) throw new Error(`Expected 67 mappings, found ${entries.length}`);
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < entries.length) {
    const entry = entries[cursor++];
    try {
      const url = new URL('https://www.youtube.com/oembed');
      url.searchParams.set('url', `https://www.youtube.com/watch?v=${entry.videoId}`);
      url.searchParams.set('format', 'json');
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = response.ok ? await response.json() : null;
      results.push({ ...entry, httpStatus: response.status, observedTitle: data?.title ?? null, observedChannel: data?.author_name ?? null, titleUnchanged: data?.title === entry.mappedTitle });
    } catch (error) {
      results.push({ ...entry, httpStatus: null, error: error.message });
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
results.sort((a, b) => a.trackId - b.trackId);
const report = { checkedAt: new Date().toISOString(), method: 'YouTube public oEmbed metadata; not a playback or regional-availability guarantee', results };
await mkdir(new URL('../verification/', import.meta.url), { recursive: true });
await writeFile(new URL('../verification/sources.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
const ok = results.filter((r) => r.httpStatus === 200).length;
console.log(`Metadata reachable: ${ok}/${entries.length}. Report: verification/sources.json`);
console.log(JSON.stringify(results.filter((r) => r.httpStatus !== 200 || !r.titleUnchanged), null, 2));
if (ok !== entries.length) process.exitCode = 1;
