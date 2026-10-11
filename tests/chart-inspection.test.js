import test from 'node:test';
import assert from 'node:assert/strict';
import { bindChartInspection } from '../public/chart-inspection.js';

test('chart inspection finds nearby samples, supports taps without interrupting scrolling, and clears on dismissal', () => {
  const listeners = {};
  const container = { addEventListener: (name, handler) => { listeners[name] = handler; } };
  const points = [
    { left: -40, width: 10, top: 100, bottom: 100 }, // Scrolled-off zero bar
    { left: 40, width: 10, top: 50, bottom: 100 },
    { left: 80, width: 10, top: 100, bottom: 100 }, // Visible zero bar
  ].map(bounds => ({
    getBoundingClientRect: () => bounds,
    classList: new Set(),
    closest: selector => selector === 'svg' ? svg : null,
  }));
  for (const point of points) point.classList.remove = point.classList.delete;
  const svg = { querySelector: () => points[0], querySelectorAll: () => points };
  const target = { closest: selector => selector === 'svg' ? svg : null };
  let shown = null;
  bindChartInspection(container, '.point', point => { shown = point; }, () => { shown = null; });
  const event = { target, clientX: 83, clientY: 105, pointerType: 'mouse' };
  listeners.pointermove(event);
  assert.equal(shown, points[2]);
  assert.ok(points[2].classList.has('chart-point-selected'));
  listeners.pointerleave(event);
  assert.equal(shown, null);
  event.pointerType = 'touch';
  listeners.pointermove(event);
  assert.equal(shown, null);
  listeners.pointerup(event);
  listeners.pointerleave(event);
  assert.equal(shown, points[2]);
  listeners.scroll();
  assert.equal(shown, null);
  listeners.pointerup(event);
  listeners.pointercancel();
  assert.equal(shown, null);
  listeners.pointerup(event);
  listeners.keydown({key:'Escape'});
  assert.equal(shown, null);
});
