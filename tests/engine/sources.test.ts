import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceResolver, parseSourceOverrides } from '../../src/sources/SourceResolver';
import { mapYouTubeError } from '../../src/audio/YouTubeProvider';
import { source, tracks } from './helpers';

afterEach(() => vi.useRealTimers());

describe('source resolution safeguards', () => {
  it('rejects unsafe URLs and unlicensed file declarations', () => {
    const parsed = parseSourceOverrides({ version: 1, entries: [
      { ...source(1), videoId: undefined, audioUrl: 'javascript:alert(1)' },
      { ...source(2), videoId: undefined, audioUrl: '/test.mp3' },
    ] });
    expect(parsed.entries).toEqual([]);
    expect(parsed.problems.length).toBeGreaterThan(1);
  });

  it('keeps provider failures independent and respects strict source preferences', () => {
    const resolver = new SourceResolver(tracks, [source(1), {
      trackId: 1, audioUrl: '/licensed.mp3',
      verification: { method: 'licensed-declaration', checkedAt: '2026-10-19', confidence: 1 },
    }]);
    expect(resolver.chooseKind(1, 'auto')).toBe('licensed');
    resolver.markRuntimeStatus(1, 'UNAVAILABLE', 'Removed', 'licensed');
    expect(resolver.chooseKind(1, 'auto')).toBe('youtube');
    expect(resolver.chooseKind(1, 'licensed')).toBeNull();
    resolver.markRuntimeStatus(1, 'EMBED_BLOCKED', 'Blocked', 'youtube');
    expect(resolver.isPlayable(1, 'auto')).toBe(false);
    expect(resolver.getSource(1).externalUrl).toContain(source(1).videoId);
  });

  it('bounds optional override loading and preserves the verified static map', async () => {
    vi.useFakeTimers();
    const resolver = new SourceResolver(tracks, [source(1)]);
    const fetcher = vi.fn((_url: RequestInfo | URL, _options?: RequestInit) => new Promise<Response>(() => undefined));
    const promise = resolver.loadOverrides('/source-overrides.json', fetcher);
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;
    expect(result.error).toContain('timed out');
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(resolver.isPlayable(1, 'youtube')).toBe(true);
  });

  it('distinguishes embed policy errors from site configuration failures', () => {
    expect(mapYouTubeError(101, 'test')).toMatchObject({ code: 'EMBED_BLOCKED', persistent: true });
    expect(mapYouTubeError(150, 'test')).toMatchObject({ code: 'EMBED_BLOCKED', persistent: true });
    expect(mapYouTubeError(153, 'test')).toMatchObject({ code: 'PROVIDER_LOAD_FAILED', persistent: false });
  });
});
