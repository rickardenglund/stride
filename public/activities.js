function keysForActivity(activity) {
  const type = activity.type.trim().toLowerCase();
  const day = JSON.stringify([activity.date, type]);
  return {
    id: activity.activityId ? String(activity.activityId) : null,
    start: activity.startTime ? JSON.stringify([activity.startTime, type]) : null,
    details: JSON.stringify([activity.date, type, activity.distance ?? null, activity.durationSeconds ?? null]),
    day,
  };
}

function compatibleIdentity(previous, incoming) {
  return !(previous.activityId && incoming.activityId && String(previous.activityId) !== String(incoming.activityId))
    && !(previous.startTime && incoming.startTime && previous.startTime !== incoming.startTime);
}

// Stable IDs and start times identify activities independently of editable metrics.
// Older records without those fields are matched only when the match is unique.
export function mergeActivities(previous, incoming) {
  const merged = [];
  const indexes = { id: new Map(), start: new Map(), details: new Map(), day: new Map() };
  const previousIndexes = new Set();
  const updatedIndexes = new Set();

  function indexActivity(activity, index, remove = false) {
    for (const [name, key] of Object.entries(keysForActivity(activity))) {
      if (key === null) continue;
      const matches = indexes[name].get(key) || new Set();
      if (remove) matches.delete(index);
      else matches.add(index);
      if (matches.size) indexes[name].set(key, matches);
      else indexes[name].delete(key);
    }
  }

  function uniqueMatch(matches, activity, legacyOnly = false) {
    const candidates = [...(matches || [])].filter((index) => {
      const candidate = merged[index];
      if (!compatibleIdentity(candidate, activity)) return false;
      if (legacyOnly) {
        return previousIndexes.has(index) && !updatedIndexes.has(index)
          && (!candidate.startTime || !activity.startTime);
      }
      return true;
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  function upsert(activity, isIncoming) {
    const keys = keysForActivity(activity);
    // An ID remains authoritative even if the date, type, or start time was edited.
    let index = keys.id ? indexes.id.get(keys.id)?.values().next().value : undefined;
    if (index === undefined && keys.start) index = uniqueMatch(indexes.start.get(keys.start), activity);
    if (index === undefined) index = uniqueMatch(indexes.details.get(keys.details), activity);
    if (index === undefined && isIncoming) index = uniqueMatch(indexes.day.get(keys.day), activity, true);

    if (index === undefined) {
      index = merged.length;
      merged.push({ ...activity });
    } else {
      const old = merged[index];
      indexActivity(old, index, true);
      merged[index] = {
        ...activity,
        ...(old.activityId && !activity.activityId ? { activityId: old.activityId } : {}),
        ...(old.startTime && !activity.startTime ? { startTime: old.startTime } : {}),
      };
      if (isIncoming) updatedIndexes.add(index);
    }
    indexActivity(merged[index], index);
    if (!isIncoming) previousIndexes.add(index);
  }

  for (const activity of previous) upsert(activity, false);
  for (const activity of incoming) upsert(activity, true);
  return merged;
}

export function runningActivities(activities) {
  return activities.filter((activity) => /(run|running|trail)/i.test(activity.type)
    && Number.isFinite(activity.distance) && activity.distance > 0);
}
