function category(type) {
  if (/trail/i.test(type)) return 'trail';
  if (/run/i.test(type)) return 'running';
  if (/cycl|bik/i.test(type)) return 'cycling';
  if (/walk|hik/i.test(type)) return 'walking';
  return 'other';
}

export function routeMatchesActivity(route, activity, activities) {
  if (route.activityId && activity.activityId) return String(route.activityId) === String(activity.activityId);
  if (route.startTime && activity.startTime) return route.startTime === activity.startTime && route.category === category(activity.type);
  // Legacy date-only routes are usable only when there is a single candidate.
  const candidates = activities.filter(item => item.date === route.date && category(item.type) === route.category);
  return candidates.length === 1 && candidates[0] === activity;
}

export function mergeRoutes(previous, incoming) {
  const result = previous.slice();
  for (const route of incoming) {
    const index = result.findIndex(old => {
      if (old.activityId && route.activityId) return String(old.activityId) === String(route.activityId);
      return old.startTime && old.startTime === route.startTime && old.category === route.category;
    });
    if (index < 0) result.push(route); else result[index] = route;
  }
  // Prefer newly linked routes over ambiguous legacy copies for the same day.
  return result.filter(route => route.activityId || route.startTime || !result.some(other =>
    other !== route && (other.activityId || other.startTime) && other.date === route.date && other.category === route.category));
}

export { category as routeCategory };
