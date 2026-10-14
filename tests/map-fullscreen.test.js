import test from 'node:test';
import assert from 'node:assert/strict';
import { addMapFullscreen } from '../public/map-fullscreen.js';

function fixture() {
  const node = () => {
    const value = { children: [], handlers: {}, attrs: {}, classList: new Set(),
      addEventListener(type, callback) { this.handlers[type] = callback; },
      removeEventListener(type) { delete this.handlers[type]; },
      setAttribute(key, text) { this.attrs[key] = text; },
      append(child) { child.remove(); this.children.push(child); child.parent = this; },
      before(child) { child.remove(); const index = this.parent.children.indexOf(this); this.parent.children.splice(index, 0, child); child.parent = this.parent; },
      replaceWith(child) { this.before(child); this.remove(); },
      remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
    };
    value.classList.remove = value.classList.delete;
    return value;
  };
  const doc = node(); doc.body = node(); doc.createElement = node; doc.createComment = node;
  const parent = node(), element = node(), controls = node();
  element.ownerDocument = doc;
  doc.body.append(parent); parent.append(controls); parent.append(element);
  let wheel = false, resizes = 0;
  const map = { scrollWheelZoom: {enable() { wheel = true; }, disable() { wheel = false; }}, invalidateSize() { resizes++; } };
  const fireChange = () => doc.handlers.fullscreenchange?.();
  element.requestFullscreen = async () => { doc.fullscreenElement = element; fireChange(); };
  doc.exitFullscreen = async () => { doc.fullscreenElement = null; fireChange(); };
  const handle = addMapFullscreen(element, map, controls);
  const button = element.children[0];
  return { doc, parent, element, controls, map, handle, button, wheel: () => wheel, resizes: () => resizes,
    click: () => button.handlers.click({stopPropagation() {}}) };
}

test('native fullscreen enables wheel zoom, includes selector, and restores it on Escape-style exit', async () => {
  const f = fixture();
  assert.equal(f.wheel(), false);
  await f.click();
  assert.equal(f.handle.isActive(), true);
  assert.equal(f.wheel(), true);
  assert.equal(f.controls.parent, f.element);
  await f.doc.exitFullscreen();
  assert.equal(f.wheel(), false);
  assert.equal(f.controls.parent, f.parent);
  assert.deepEqual(f.parent.children, [f.controls, f.element]);
  f.handle.destroy();
  assert.equal(f.doc.handlers.fullscreenchange, undefined);
});

test('fullscreen rejection opens a full-window dialog and restores map and selector on cancel', async () => {
  const f = fixture();
  f.element.requestFullscreen = async () => { throw new Error('Unavailable'); };
  await f.click();
  const dialog = f.element.parent;
  assert.equal(dialog.className, 'map-fullscreen-dialog');
  assert.equal(dialog.open, true);
  assert.equal(f.wheel(), true);
  assert.equal(f.controls.parent, f.element);
  dialog.handlers.cancel({preventDefault() {}});
  assert.equal(f.handle.isActive(), false);
  assert.equal(f.wheel(), false);
  assert.deepEqual(f.parent.children, [f.controls, f.element]);
  assert.equal(dialog.parent, null);
  f.handle.destroy();
});

test('fullscreen exit button and cleanup both restore embedded controls', async () => {
  const f = fixture();
  await f.click(); await f.click();
  assert.equal(f.wheel(), false);
  f.element.requestFullscreen = undefined;
  await f.click();
  f.handle.destroy();
  assert.deepEqual(f.parent.children, [f.controls, f.element]);
  assert.equal(f.wheel(), false);
  assert.ok(f.resizes() > 1);
});
