export function bindChartInspection(container, selector, show, hide) {
  let selected = null;
  const clear = () => {
    selected?.classList.remove("chart-point-selected");
    selected = null;
    hide();
  };
  const inspect = event => {
    const svg = event.target.closest("svg");
    if (!svg || !svg.querySelector(selector)) { clear(); return; }
    let point = event.target.closest(selector);
    if (!point) {
      let distance = Infinity;
      for (const candidate of svg.querySelectorAll(selector)) {
        const bounds = candidate.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = Math.max(bounds.top - event.clientY, 0, event.clientY - bounds.bottom);
        const next = dx * dx + dy * dy;
        if (next < distance) { point = candidate; distance = next; }
      }
    }
    if (!point) return;
    selected?.classList.remove("chart-point-selected");
    selected = point;
    point.classList.add("chart-point-selected");
    show(point, event.clientX, event.clientY);
  };
  container.addEventListener("pointermove", event => { if (event.pointerType !== "touch") inspect(event); });
  container.addEventListener("pointerup", event => { if (event.pointerType === "touch") inspect(event); });
  container.addEventListener("pointerleave", event => { if (event.pointerType !== "touch") clear(); });
  container.addEventListener("pointerout", event => {
    if (event.pointerType === "touch") return;
    const svg = event.target.closest?.("svg");
    if (svg && event.relatedTarget?.closest?.("svg") !== svg) clear();
  });
  container.addEventListener("pointercancel", clear);
  container.addEventListener("focusin", event => {
    const point = event.target.closest(selector);
    if (!point) return;
    const bounds = point.getBoundingClientRect();
    inspect({ target: point, clientX: bounds.left + bounds.width / 2, clientY: bounds.top });
  });
  container.addEventListener("focusout", clear);
  container.addEventListener("keydown", event => { if (event.key === "Escape") clear(); });
  container.addEventListener("scroll", clear, { capture: true, passive: true });
}

