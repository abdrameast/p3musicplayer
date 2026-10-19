import { describe, expect, it, vi } from 'vitest';
import { AudioFeatureEngine } from '../../src/audio/AudioFeatureEngine';
import { estimateBpm, foldBpm } from '../../src/audio/AudioAnalyzer';
import { fixture, flush } from './helpers';

function audioGraph() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const analyser = {
    ...node(), fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0, minDecibels: -90, maxDecibels: -20,
    getByteFrequencyData: (out: Uint8Array) => out.fill(0), getFloatTimeDomainData: (out: Float32Array) => out.fill(0),
  };
  const streamSource = node();
  const mediaSource = node();
  const context = {
    state: 'running', sampleRate: 48000, onstatechange: null,
    destination: node(), resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
    createAnalyser: vi.fn(() => analyser), createMediaStreamSource: vi.fn(() => streamSource),
    createMediaElementSource: vi.fn(() => mediaSource),
  };
  return { context, streamSource, mediaSource, analyser, createContext: () => context as unknown as AudioContext };
}

function capture(hasAudio = true) {
  const audio = Object.assign(new EventTarget(), { readyState: 'live', stop: vi.fn() });
  const video = Object.assign(new EventTarget(), { readyState: 'live', stop: vi.fn() });
  const stream = {
    getAudioTracks: () => hasAudio ? [audio] : [],
    getTracks: () => hasAudio ? [audio, video] : [video],
  } as unknown as MediaStream;
  return { stream, audio, video };
}

function engineFixture() {
  const base = fixture();
  const graph = audioGraph();
  const mediaDevices = { getUserMedia: vi.fn<MediaDevices['getUserMedia']>(), getDisplayMedia: vi.fn<MediaDevices['getDisplayMedia']>() };
  const tempos: Record<number, number> = {};
  const engine = new AudioFeatureEngine({
    bus: base.bus, player: base.player, createContext: graph.createContext, mediaDevices,
    getTapTempo: () => tempos,
    setTapTempo: (id, bpm) => { if (bpm === null) delete tempos[id]; else tempos[id] = bpm; },
  });
  return { ...base, ...graph, mediaDevices, tempos, engine };
}

describe('audio feature engine', () => {
  it('starts without a permission request and labels simulated visuals honestly', async () => {
    const { engine, mediaDevices, player } = engineFixture();
    await player.init();
    await player.play();
    expect(engine.getStatus()).toMatchObject({ mode: 'simulated', real: false });
    expect(engine.getStatus().label).toContain('SIMULATED');
    expect(engine.update(1 / 60, 500).level).toBeGreaterThan(0);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    engine.dispose(); player.dispose();
  });

  it('keeps the player usable after microphone permission is refused', async () => {
    const { engine, mediaDevices, player } = engineFixture();
    mediaDevices.getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    await player.init();
    const result = await engine.setMode('mic');
    expect(result).toMatchObject({ ok: false, error: 'denied', status: { mode: 'simulated', real: false } });
    await player.play();
    expect(player.getState().status).toBe('PLAYING');
    engine.dispose(); player.dispose();
  });

  it('rejects a screen share without audio and stops the unused video track', async () => {
    const { engine, mediaDevices, player } = engineFixture();
    const shared = capture(false);
    mediaDevices.getDisplayMedia.mockResolvedValue(shared.stream);
    expect(await engine.setMode('tab')).toMatchObject({ ok: false, error: 'no-audio-track' });
    expect(shared.video.stop).toHaveBeenCalledOnce();
    expect(engine.getStatus().real).toBe(false);
    engine.dispose(); player.dispose();
  });

  it('analyses tab audio without speaker feedback and returns to simulation when sharing ends', async () => {
    const { engine, mediaDevices, streamSource, context, analyser, player } = engineFixture();
    const shared = capture();
    mediaDevices.getDisplayMedia.mockResolvedValue(shared.stream);
    expect(await engine.setMode('tab')).toMatchObject({ ok: true, status: { real: true, mode: 'tab' } });
    expect(streamSource.connect).toHaveBeenCalledWith(analyser);
    expect(streamSource.connect).not.toHaveBeenCalledWith(context.destination);
    shared.audio.dispatchEvent(new Event('ended'));
    expect(engine.getStatus()).toMatchObject({ mode: 'simulated', real: false });
    expect(shared.audio.stop).toHaveBeenCalledOnce();
    expect(shared.video.stop).toHaveBeenCalledOnce();
    expect(streamSource.disconnect).toHaveBeenCalledOnce();
    engine.dispose(); player.dispose();
  });

  it('closes a late permission grant after another mode is selected', async () => {
    const { engine, mediaDevices, player } = engineFixture();
    let grant!: (stream: MediaStream) => void;
    mediaDevices.getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const pending = engine.setMode('mic');
    await engine.setMode('simulated');
    const shared = capture();
    grant(shared.stream);
    expect(await pending).toMatchObject({ ok: false, error: 'cancelled' });
    expect(shared.audio.stop).toHaveBeenCalledOnce();
    expect(engine.getStatus().mode).toBe('simulated');
    engine.dispose(); player.dispose();
  });

  it('closes a late permission grant after disposal', async () => {
    const { engine, mediaDevices, context, player } = engineFixture();
    let grant!: (stream: MediaStream) => void;
    mediaDevices.getDisplayMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const pending = engine.setMode('tab');
    engine.dispose();
    const shared = capture();
    grant(shared.stream);
    expect(await pending).toMatchObject({ error: 'cancelled' });
    expect(shared.audio.stop).toHaveBeenCalledOnce();
    expect(shared.video.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    player.dispose();
  });

  it('reuses the direct media source and keeps a speaker path when analysis is disabled', async () => {
    const { engine, player, context, mediaSource } = engineFixture();
    const element = document.createElement('audio');
    vi.spyOn(player, 'getMediaElement').mockReturnValue(element);
    expect(await engine.setMode('direct')).toMatchObject({ ok: true, status: { real: true } });
    await engine.setMode('simulated');
    expect(mediaSource.connect).toHaveBeenLastCalledWith(context.destination);
    await engine.setMode('direct');
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
    engine.dispose(); player.dispose();
  });

  it('reports unsupported modes without trying to acquire audio', async () => {
    const { engine, player } = engineFixture();
    expect(engine.isSupported('direct')).toBe(false);
    expect(await engine.setMode('direct')).toMatchObject({ ok: false, error: 'unsupported', status: { real: false } });
    engine.dispose(); player.dispose();
  });

  it('estimates, persists and resets per-track tap tempo after three taps', async () => {
    const { engine, tempos, player } = engineFixture();
    expect(engine.tap(1, 0)).toBeNull();
    expect(engine.tap(1, 500)).toBeNull();
    expect(engine.tap(1, 1000)).toBe(120);
    expect(tempos[1]).toBe(120);
    expect(engine.tap(2, 0)).toBeNull();
    expect(engine.tap(2, 600)).toBeNull();
    expect(engine.tap(2, 1200)).toBe(100);
    expect(engine.getBpm(2)).toBe(100);
    engine.resetBpm(2);
    expect(tempos[2]).toBeUndefined();
    expect(engine.tap(1, 5000)).toBeNull();
    expect(engine.tap(1, 5050)).toBeNull();
    await flush();
    engine.dispose(); player.dispose();
  });

  it('extracts tempo from regularly spaced onsets and handles invalid estimates', () => {
    expect(estimateBpm([0, 500, 1000, 1500, 2000, 2500, 3000])).toBe(120);
    expect(estimateBpm([0, 500])).toBeNull();
    expect(foldBpm(0)).toBe(120);
    expect(foldBpm(Number.POSITIVE_INFINITY)).toBe(120);
  });
});
