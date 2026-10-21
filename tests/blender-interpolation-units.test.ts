import { expect, it } from 'vitest';
import { baseSample, baseCurve, ensureCurve, readCurve } from '../src/core/curves';
import { createProject, pose } from '../src/core/model';
import { applyKeySettings } from '../src/core/timelineSettings';
import { StudioStore } from '../src/core/store';

const elastic = { amplitude: 0.2, period: 12.8 };

const elasticTrack = () => {
  const track = createProject({}, false).tracks.root;
  track.interpolation = 'elastic';
  track.easing = 'out';
  track.elastic = { ...elastic };
  track.keys = [
    { ...pose([0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0, 0]), frame: 0, interpolation: 'elastic' },
    { ...pose([0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0, 0]), frame: 20, interpolation: 'linear' },
  ];
  return track;
};

it('projects native elastic amplitudes into position and grip channel units', () => {
  const track = elasticTrack();
  const native = baseSample(track, 6);
  const position = readCurve(track, 'px');
  const grip = readCurve(track, 'thumb');

  expect(position.keys[0].elastic?.amplitude).toBe(20);
  expect(grip.keys[0].elastic?.amplitude).toBe(20);
  expect(baseCurve(position, 6) / 100).toBeCloseTo(native.p[0], 8);
  expect(baseCurve(grip, 6) / 100).toBeCloseTo(native.grip[0], 8);
  expect(Math.abs(native.p[0])).toBeGreaterThan(0);
  expect(Math.abs(native.grip[0])).toBeGreaterThan(0);
});

it('leaves already channel-unit curves and non-scaled projections unchanged', () => {
  const track = elasticTrack();
  expect(readCurve(track, 'fov').keys[0].elastic?.amplitude).toBe(elastic.amplitude);
  expect(readCurve(track, 'qx').keys[0].elastic?.amplitude).toBe(elastic.amplitude);
  // Euler channels are derived from quaternion values, so a fixed native-unit
  // to degree conversion would be orientation-dependent and is not applied.
  expect(readCurve(track, 'rx').keys[0].elastic?.amplitude).toBe(elastic.amplitude);

  const explicit = structuredClone(readCurve(track, 'px'));
  explicit.keys[0].elastic = { ...elastic };
  track.curves = { px: explicit };
  expect(readCurve(track, 'px').keys[0].elastic?.amplitude).toBe(elastic.amplitude);
});

it('keeps scaled amplitudes when materializing projected curves', () => {
  const track = elasticTrack();
  const position = ensureCurve(track, 'px');
  const grip = ensureCurve(track, 'thumb');
  expect(position.keys[0].elastic?.amplitude).toBe(20);
  expect(grip.keys[0].elastic?.amplitude).toBe(20);
  expect(track.elastic?.amplitude).toBe(elastic.amplitude);
  expect(track.keys[0].elastic).toBeUndefined();
});

it('projects elastic settings when changing a track with an explicit position curve', () => {
  const project = createProject({}, false),
    track = project.tracks.root;
  track.interpolation = 'linear';
  track.easing = 'out';
  track.elastic = { ...elastic };
  track.keys = [
    { ...pose(), frame: 0, interpolation: 'linear' },
    { ...pose([0.1, 0, 0]), frame: 20, interpolation: 'linear' },
  ];
  track.curves = { px: structuredClone(readCurve(track, 'px')) };

  const store = new StudioStore();
  store.open(project);
  store.patch({ selected: 'root' });
  store.setInterpolation('elastic');

  const result = store.state.project!.tracks.root;
  expect(result.elastic?.amplitude).toBe(elastic.amplitude);
  expect(result.keys[0].elastic?.amplitude).toBe(elastic.amplitude);
  expect(result.curves?.px?.keys[0].elastic?.amplitude).toBe(20);
  const firstCurveElastic = result.curves?.px?.keys[0].elastic,
    lastCurveElastic = result.curves?.px?.keys.at(-1)?.elastic;
  expect(firstCurveElastic).not.toBe(lastCurveElastic);
  firstCurveElastic!.amplitude = 1;
  expect(lastCurveElastic?.amplitude).toBe(20);
});

it('keeps native pose settings and projected curve settings separate on edits', () => {
  const project = createProject({}, false),
    track = project.tracks.root;
  track.interpolation = 'elastic';
  track.easing = 'out';
  track.elastic = { ...elastic };
  track.keys = [
    { ...pose(), frame: 0, interpolation: 'elastic' },
    { ...pose([0.1, 0, 0]), frame: 20, interpolation: 'elastic' },
  ];
  track.curves = { px: structuredClone(readCurve(track, 'px')) };

  const store = new StudioStore();
  store.open(project);
  store.patch({ selected: 'root' });
  store.setMotionOptions({ elastic: { amplitude: 0.35, period: 8 }, easing: 'out' });

  const result = store.state.project!.tracks.root;
  expect(result.elastic?.amplitude).toBe(0.35);
  expect(result.keys[0].elastic?.amplitude).toBe(0.35);
  expect(result.curves?.px?.keys[0].elastic?.amplitude).toBe(35);
  const firstCurveElastic = result.curves?.px?.keys[0].elastic,
    lastCurveElastic = result.curves?.px?.keys.at(-1)?.elastic;
  expect(firstCurveElastic).not.toBe(lastCurveElastic);
  firstCurveElastic!.amplitude = 1;
  expect(lastCurveElastic?.amplitude).toBe(35);
});

it('converts timeline display-unit elastic edits back to native pose units', () => {
  const project = createProject({}, false),
    track = project.tracks.root;
  track.interpolation = 'linear';
  track.easing = 'out';
  track.elastic = { ...elastic };
  track.keys = [
    { ...pose(), frame: 0, interpolation: 'linear' },
    { ...pose([0.1, 0, 0]), frame: 20, interpolation: 'linear' },
  ];
  track.curves = { px: structuredClone(readCurve(track, 'px')) };

  const next = applyKeySettings(project, [{ id: 'root', frame: 0 }], {
    interpolation: 'elastic',
    easing: 'out',
    elastic: { amplitude: 20, period: 12.8 },
  });
  const result = next.tracks.root;
  expect(result.keys[0].elastic?.amplitude).toBe(0.2);
  expect(result.curves?.px?.keys[0].elastic?.amplitude).toBe(20);
});

it('projects timeline motion independently for mixed position and quaternion curves', () => {
  const project = createProject({}, false),
    track = project.tracks.root;
  track.rotationMode = 'quaternion';
  track.interpolation = 'linear';
  track.easing = 'out';
  track.elastic = { ...elastic };
  track.keys = [
    { ...pose(), frame: 0, interpolation: 'linear' },
    { ...pose([0.1, 0, 0]), frame: 20, interpolation: 'linear' },
  ];
  track.curves = {
    px: structuredClone(readCurve(track, 'px')),
    qx: structuredClone(readCurve(track, 'qx')),
  };

  const next = applyKeySettings(project, [{ id: 'root', frame: 0 }], {
    interpolation: 'elastic',
    easing: 'out',
    elastic: { amplitude: 20, period: 12.8 },
  });
  const result = next.tracks.root;
  expect(result.keys[0].elastic?.amplitude).toBe(0.2);
  expect(result.curves?.px?.keys[0].elastic?.amplitude).toBe(20);
  expect(result.curves?.qx?.keys[0].elastic?.amplitude).toBe(0.2);
});
