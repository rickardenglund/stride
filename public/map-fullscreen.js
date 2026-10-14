// Keep the same map instance and viewport when entering or leaving fullscreen.
export function addMapFullscreen(element, map, controls = null) {
  const doc = element.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'map-fullscreen-button leaflet-control';
  element.append(button);
  let dialog = null, placeholder = null, controlsPlaceholder = null, disposed = false;
  const active = () => doc.fullscreenElement === element || Boolean(dialog);
  const restoreControls = () => {
    if (!controlsPlaceholder) return;
    controlsPlaceholder.replaceWith(controls);
    controlsPlaceholder = null;
    controls.classList.remove('map-fullscreen-controls');
  };
  const stopControlEvent = event => event.stopPropagation();
  const controlEvents = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel'];
  for (const type of controlEvents) controls?.addEventListener(type, stopControlEvent);
  const sync = () => {
    const expanded = active();
    if (expanded && controls && !controlsPlaceholder) {
      controlsPlaceholder = doc.createComment('Map controls position');
      controls.before(controlsPlaceholder);
      element.append(controls);
      controls.classList.add('map-fullscreen-controls');
    } else if (!expanded) restoreControls();
    map.scrollWheelZoom[expanded ? 'enable' : 'disable']();
    button.textContent = expanded ? 'Exit fullscreen' : '⛶ Fullscreen';
    button.setAttribute('aria-label', expanded ? 'Exit map fullscreen' : 'Open map fullscreen');
    button.setAttribute('aria-pressed', String(expanded));
    map.invalidateSize({ animate: false, pan: false });
  };
  const closeDialog = () => {
    if (!dialog) return;
    const previous = dialog;
    dialog = null;
    placeholder.replaceWith(element);
    placeholder = null;
    previous.close();
    previous.remove();
    sync();
    button.focus({ preventScroll: true });
  };
  const openDialog = () => {
    dialog = doc.createElement('dialog');
    dialog.className = 'map-fullscreen-dialog';
    dialog.setAttribute('aria-label', 'Fullscreen map');
    placeholder = doc.createComment('Map position');
    element.before(placeholder);
    doc.body.append(dialog);
    dialog.append(element);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.showModal();
    sync();
    button.focus({ preventScroll: true });
  };
  const changed = () => { if (!disposed) sync(); };
  doc.addEventListener('fullscreenchange', changed);
  for (const type of ['pointerdown', 'dblclick', 'wheel']) button.addEventListener(type, event => event.stopPropagation());
  button.addEventListener('click', async event => {
    event.stopPropagation();
    if (dialog) { closeDialog(); return; }
    button.disabled = true;
    try {
      if (doc.fullscreenElement === element) {
        await doc.exitFullscreen();
      } else {
        try {
          if (!element.requestFullscreen) throw new Error('Fullscreen API unavailable');
          await element.requestFullscreen();
        } catch {
          if (!disposed) openDialog();
        }
      }
    } finally {
      button.disabled = false;
      if (!disposed) sync();
    }
  });
  sync();
  return { isActive: active, destroy() {
    disposed = true;
    doc.removeEventListener('fullscreenchange', changed);
    closeDialog();
    restoreControls();
    for (const type of controlEvents) controls?.removeEventListener(type, stopControlEvent);
    if (doc.fullscreenElement === element) doc.exitFullscreen().catch(() => {});
    button.remove();
  } };
}
