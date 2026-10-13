import { it, expect } from 'vitest';
import { StudioStore } from '../src/core/store';
it('publishes display subframes without modifying authored time or waking the editor store', () => {
  const store = new StudioStore();
  let chrome = 0,
    cursor = 0;
  const unsubscribe = store.subscribe(() => chrome++),
    stop = store.displayClock.subscribe(() => cursor++);
  for (let i = 1; i <= 120; i++) store.displayClock.publish((i / 120) * 24);
  expect(cursor).toBe(120);
  expect(chrome).toBe(0);
  expect(store.state.frame).toBe(0);
  expect(store.displayClock.getSnapshot()).toBe(24);
  store.displayClock.publish(24);
  store.displayClock.publish(NaN);
  expect(cursor).toBe(120);
  stop();
  unsubscribe();
});
