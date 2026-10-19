import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { TRACKS, COLLECTIONS } from '../src/config/tracks';
import { SOURCE_MAP } from '../src/config/source-map';
import { PreferencesStore, sanitizePreferences } from '../src/core/Preferences';
import { CameraRig, computeFraming } from '../src/scene/CameraRig';
import { QualityManager, pickInitialProfile } from '../src/scene/QualityManager';
import canonicalBrief from './fixtures/canonical-catalogue.json';

describe('canonical archive', () => {
  it('matches every title, artist and position supplied in the original brief', () => {
    expect(TRACKS.map(({ id, title, artist }) => ({ id, title, artist }))).toEqual(canonicalBrief);
  });
  it('contains exactly the 67 ordered, unique canonical ids across nine collections', () => {
    expect(TRACKS).toHaveLength(67);
    expect(TRACKS.map((track) => track.id)).toEqual(Array.from({ length: 67 }, (_, i) => i + 1));
    expect(COLLECTIONS.map((collection) => TRACKS.filter((track) => track.collection === collection.id).length))
      .toEqual([9, 3, 5, 5, 15, 2, 6, 20, 2]);
    expect(TRACKS.every((track) => track.title.length > 0 && track.artist.length > 0)).toBe(true);
  });
  it('preserves Japanese and keeps original, movie, Reload and arrangement versions distinct', () => {
    expect(TRACKS[2].title).toBe('やすらぎ (Peace)');
    expect(TRACKS[47].title).toBe('やすらぎ -Reload-');
    expect(TRACKS[49].title).toBe('巌戸台分寮 -Reload- (Iwatodai Dorm)');
    expect(TRACKS[58].title).toBe('キミの記憶 -Reload- (Memories of You)');
    expect([TRACKS[0].title, TRACKS[22].title, TRACKS[59].title])
      .toEqual(['Burn My Dread (Full)', 'Burn My Dread (Movie Ver.)', 'Burn My Dread -Reload-']);
    expect(TRACKS[65].title).toBe('Ça va barder maintenant -Arrangement P5X-');
  });
  it('uses explicit independently identified source mappings for every canonical track', () => {
    expect(SOURCE_MAP).toHaveLength(67);
    expect(new Set(SOURCE_MAP.map((source) => source.trackId)).size).toBe(67);
    expect(new Set(SOURCE_MAP.map((source) => source.videoId)).size).toBe(67);
    for (const source of SOURCE_MAP) {
      expect(source.videoId).toMatch(/^[\w-]{11}$/);
      expect(source.verification.observedTitle).toBeTruthy();
      expect(source.verification.confidence).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('preferences', () => {
  it('restores playback and presentation preferences after storage round-trip', () => {
    const store = new PreferencesStore(localStorage, 'test-mf-preferences');
    store.set({ volume: 0.35, lastTrackId: 53, repeat: 'one', visualMode: 'bluememory', motion: 'reduce', tapTempo: { 53: 110 } });
    store.flush();
    const restored = new PreferencesStore(localStorage, 'test-mf-preferences').get();
    expect(restored).toMatchObject({ volume: 0.35, lastTrackId: 53, repeat: 'one', visualMode: 'bluememory', motion: 'reduce', tapTempo: { 53: 110 } });
    localStorage.removeItem('test-mf-preferences');
  });
  it('recovers from invalid storage and clamps untrusted values', () => {
    const sanitized = sanitizePreferences({ volume: 8, lastTrackId: -10, quality: 'ultra', visualMode: 'garbage', tapTempo: { 100: 120, 1: 999, 2: 120 } });
    expect(sanitized.volume).toBe(1);
    expect(sanitized.lastTrackId).toBe(46);
    expect(sanitized.quality).toBe('auto');
    expect(sanitized.visualMode).toBe('moonlight');
    expect(sanitized.tapTempo).toEqual({ 2: 120 });
    localStorage.setItem('test-mf-corrupt', '{not json');
    expect(new PreferencesStore(localStorage, 'test-mf-corrupt').get().lastTrackId).toBe(46);
    localStorage.removeItem('test-mf-corrupt');
  });
  it('continues in memory when storage is unavailable', () => {
    const store = new PreferencesStore(null);
    store.set({ muted: true });
    expect(() => store.flush()).not.toThrow();
    expect(store.get().muted).toBe(true);
  });
});

describe('hero framing', () => {
  it.each([[360, 640], [390, 844], [768, 1024], [1280, 720], [1440, 900], [1920, 1080], [2560, 1080]])
    ('centres the hero inside its layout slot at %dx%d', (width, height) => {
      const hero = { x: width * 0.24, y: height * 0.12, width: width * 0.5, height: height * 0.58 };
      const rig = new CameraRig();
      rig.setViewport(width, height);
      rig.setTarget(hero, 2.5, true);
      const projected = new Vector3(0, 0, 0).project(rig.camera);
      expect((projected.x + 1) * width / 2).toBeCloseTo(hero.x + hero.width / 2, 5);
      expect((1 - projected.y) * height / 2).toBeCloseTo(hero.y + hero.height / 2, 5);
      expect(rig.getScreenFocus().radius * 2).toBeLessThan(Math.min(hero.width, hero.height));
      expect(computeFraming(width, height, hero, 2.5).distance).toBeGreaterThan(2.5);
    });
  it('keeps bass camera movement below the configured 1.5% limit', () => {
    const rig = new CameraRig();
    rig.setViewport(1440, 900);
    rig.setTarget({ x: 350, y: 100, width: 700, height: 600 }, 2.5, true);
    const initial = rig.camera.position.z;
    for (let i = 0; i < 240; i++) rig.update(1 / 60, 1, 1, false);
    expect((initial - rig.camera.position.z) / initial).toBeLessThan(0.015);
  });
});

describe('adaptive quality', () => {
  const desktop = { coarsePointer: false, mobile: false, viewportWidth: 1440, viewportHeight: 900 };
  it('selects a lower budget for constrained mobile hardware', () => {
    expect(pickInitialProfile({ ...desktop, mobile: true, deviceMemory: 4 })).toBe('low');
    expect(pickInitialProfile(desktop)).toBe('high');
  });
  it('reduces automatic quality on sustained slow frames, but ignores suspended tabs', () => {
    const quality = new QualityManager('auto', desktop);
    for (let i = 0; i < 300; i++) quality.sample(0.03);
    expect(quality.profile).toBe('medium');
    for (let i = 0; i < 100; i++) quality.sample(10);
    expect(quality.profile).toBe('medium');
    quality.setSetting('high');
    for (let i = 0; i < 1000; i++) quality.sample(0.05);
    expect(quality.profile).toBe('high');
  });
});
