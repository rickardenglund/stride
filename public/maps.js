const MAX_LATITUDE = 85.05112878;
export function mercatorLatitude(latitude) {
  const radians = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 180 / Math.PI;
}
export function inverseMercatorLatitude(y) {
  return (2 * Math.atan(Math.exp(y * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
}

export function projectMapRoutes(routes, width, height, padding = 20) {
  const origin = routes[0][0].lon;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const projected = routes.map(points => points.map((point, index) => {
    const x = origin + ((point.lon - origin + 540) % 360) - 180;
    const y = mercatorLatitude(point.lat);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    return { index: point.index ?? index, x, y };
  }));
  // A minimum extent gives stationary routes a useful neighborhood view.
  const scale = Math.min((width - padding * 2) / Math.max(maxX - minX, .001),
    (height - padding * 2) / Math.max(maxY - minY, .001));
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const left = centerX - width / scale / 2, top = centerY + height / scale / 2;
  const bounds = [[inverseMercatorLatitude(top - height / scale), left],
    [inverseMercatorLatitude(top), left + width / scale]];
  return { bounds, coordinates: projected.map(points => points.map(point => ({
    index: point.index, routeX: (point.x - left) * scale, routeY: (top - point.y) * scale,
  }))) };
}

const maps = new WeakMap();
export function mountBackgroundMap(element, markup, bounds) {
  const previous = maps.get(element);
  previous?.observer?.disconnect();
  previous?.visibility?.disconnect();
  previous?.map?.remove();
  maps.delete(element);
  element.innerHTML = markup;
  if (!markup || !bounds || !globalThis.L || !globalThis.ResizeObserver) return;
  const state = {};
  maps.set(element, state);
  const update = () => {
    if (!element.clientWidth || !element.clientHeight) return;
    if (!state.map) {
      const svg = element.querySelector('svg');
      element.innerHTML = '';
      state.map = L.map(element, { scrollWheelZoom: false, zoomAnimation: false,
        fadeAnimation: false, markerZoomAnimation: false, attributionControl: true });
      state.map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, keepBuffer: 0, referrerPolicy: 'strict-origin-when-cross-origin',
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }).addTo(state.map);
      L.svgOverlay(svg, bounds, { interactive: true, className: 'training-map-overlay' }).addTo(state.map);
      state.map.fitBounds(bounds, { animate: false, maxZoom: 17 });
    } else {
      state.map.invalidateSize({ animate: false, pan: false });
    }
  };
  state.observer = new ResizeObserver(update);
  state.observer.observe(element);
  // ResizeObserver also fires on hidden-to-visible transitions.
}
