export const HEATMAP_TYPE_GROUPS = [
  { id: 'group:running', label: 'Running / Trail', matches: type => /run|trail/.test(type) },
  { id: 'group:cycling', label: 'Cycling / Gravel', matches: type => /cycl|bik/.test(type) },
  { id: 'group:walking', label: 'Walking / Hiking', matches: type => /walk|hik/.test(type) },
  { id: 'group:climbing', label: 'Bouldering / Indoor Climbing', matches: type => type === 'bouldering' || type === 'indoor climbing' },
];

export function heatmapGroupTypes(id, types) {
  const group = HEATMAP_TYPE_GROUPS.find(group => group.id === id);
  return group ? types.filter(group.matches) : [];
}

export function defaultHeatmapSelection(types) {
  return new Set(heatmapGroupTypes('group:running', types));
}

export function heatmapOptionState(selection, types, option) {
  const members = option === 'all' ? types : option.startsWith('group:') ? heatmapGroupTypes(option, types) : [option];
  const count = members.filter(type => selection.has('all') || selection.has(type)).length;
  return { checked: members.length > 0 && count === members.length, indeterminate: count > 0 && count < members.length };
}

export function normalizeHeatmapSelection(selection, types) {
  if (selection.has('all')) return new Set(['all']);
  const selected = new Set(types.filter(type => selection.has(type)));
  return types.length && selected.size === types.length ? new Set(['all']) : selected;
}

export function toggleHeatmapType(selection, types, type, checked) {
  if (type === 'all') return checked ? new Set(['all']) : new Set();
  const selected = new Set(selection.has('all') ? types : [...selection]);
  const members = type.startsWith('group:') ? heatmapGroupTypes(type, types) : [type];
  for (const member of members) {
    if (checked) selected.add(member); else selected.delete(member);
  }
  return normalizeHeatmapSelection(selected, types);
}

export function selectedHeatmapRoutes(groups, selection) {
  return [...groups].filter(([type]) => selection.has('all') || selection.has(type))
    .flatMap(([, routes]) => routes);
}
