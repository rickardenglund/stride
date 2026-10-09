function parseRows(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  let commaCount = 0;
  let semicolonCount = 0;
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    if (firstLine[index] === '"') {
      if (quoted && firstLine[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && firstLine[index] === ",") {
      commaCount += 1;
    } else if (!quoted && firstLine[index] === ";") {
      semicolonCount += 1;
    }
  }
  const delimiter = semicolonCount > commaCount ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("This CSV contains an unclosed quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[_\s]+/g, " ");
}

function parseActivityDate(value) {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month}-${day}`;
  }
  const european = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (european) {
    const [, day, month, year] = european;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function parseDistance(value) {
  const cleaned = value.trim().replace(/\s/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && !cleaned.includes(".")
    ? cleaned.replace(",", ".")
    : cleaned.replace(/,/g, "");
  const distance = Number(normalized);
  return Number.isFinite(distance) && distance > 0 ? distance : null;
}

function parseTimeSeconds(value) {
  const match = value.trim().match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3] || 0);
  return match[3] === undefined ? first * 60 + second : first * 3600 + second * 60 + third;
}

function parsePaceSecondsPerKm(value, header) {
  const match = value.trim().match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?(?:\s*(?:\/|per)\s*(km|mi))?$/i);
  if (!match) return null;
  const paceSeconds = match[3] === undefined
    ? Number(match[1]) * 60 + Number(match[2])
    : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  const unit = (match[4] || header).toLowerCase();
  return /\bmi\b|mile/.test(unit) ? paceSeconds / 1.609344 : paceSeconds;
}

export function normalizeStoredRuns(runs, distanceUnit) {
  const inferredUnit = distanceUnit === "m"
    ? "m"
    : distanceUnit === "km"
      ? "km"
      : Math.max(...runs.map((run) => run.distance), 0) < 1000
        ? "km"
        : "m";
  const multiplier = inferredUnit === "km" ? 1000 : 1;
  return runs.map((run) => ({
    ...run,
    distance: run.distance * multiplier,
    type: typeof run.type === "string" ? run.type : "Running",
    paceSecondsPerKm: Number.isFinite(run.paceSecondsPerKm) ? run.paceSecondsPerKm : null,
  }));
}

export function parseGarminCsv(text, fallbackUnit = "km") {
  const rows = parseRows(text);
  if (rows.length < 2) throw new Error("The CSV has no activity rows.");

  const headers = rows[0].map(normalizeHeader);
  const findColumn = (candidates) => headers.findIndex((header) => candidates.includes(header));
  const typeIndex = findColumn(["activity type", "type"]);
  const dateIndex = findColumn(["date", "start time", "start date", "activity date"]);
  const distanceIndex = headers.findIndex((header) => /^distance(?:\s*\(.*\))?$/.test(header));
  const durationIndex = headers.findIndex((header) =>
    ["time", "elapsed time", "moving time", "duration"].includes(header),
  );
  const paceIndex = headers.findIndex((header) =>
    /^(?:(?:avg|average)\.? )?pace(?:\s*\(.*\))?$/.test(header),
  );
  const heartRateIndex = headers.findIndex((header) => /^(?:avg|average)\.? hr$/.test(header));
  const activityIdIndex = findColumn(["activity id", "activityid"]);
  if (typeIndex === -1 || dateIndex === -1 || distanceIndex === -1) {
    throw new Error("Could not find Activity Type, Date, and Distance columns. Choose the Garmin Connect Activities CSV.");
  }

  const distanceHeader = headers[distanceIndex];
  const headerUnit = /\bmi(?:le)?s?\b/.test(distanceHeader)
    ? "mi"
    : /\bkm\b|kilometer/.test(distanceHeader)
      ? "km"
      : /\bmeters?\b|\(m\)/.test(distanceHeader)
        ? "m"
      : null;
  const unit = headerUnit || fallbackUnit;
  const multiplier = unit === "mi" ? 1.609344 : unit === "m" ? 0.001 : 1;
  const runs = [];
  const activities = [];

  for (const row of rows.slice(1)) {
    const activityType = (row[typeIndex] || "").trim();
    if (!activityType) continue;
    const date = parseActivityDate(row[dateIndex] || "");
    if (!date) continue;
    const distance = parseDistance(row[distanceIndex] || "");
    const distanceMeters = distance === null ? null : distance * multiplier * 1000;
    const averagePace = paceIndex === -1
      ? null
      : parsePaceSecondsPerKm(row[paceIndex] || "", headers[paceIndex]);
    const durationSeconds = durationIndex === -1 ? null : parseTimeSeconds(row[durationIndex] || "");
    const paceSecondsPerKm = averagePace
      ?? (durationSeconds && distanceMeters ? durationSeconds / (distanceMeters / 1000) : null);
    const averageHeartRate = heartRateIndex === -1
      ? null
      : Number.parseFloat((row[heartRateIndex] || "").replace(/[^\d.].*$/, ""));
    const activity = {
      date,
      type: activityType,
      distance: distanceMeters,
      durationSeconds,
      paceSecondsPerKm,
      averageHeartRate: Number.isFinite(averageHeartRate) ? averageHeartRate : null,
      ...(activityIdIndex !== -1 && (row[activityIdIndex] || "").trim()
        ? { activityId: (row[activityIdIndex] || "").trim() }
        : {}),
    };
    activities.push(activity);

    if (/(run|running|trail)/i.test(activityType) && distanceMeters !== null) {
      runs.push({ ...activity, distance: distanceMeters });
    }
  }

  if (runs.length === 0) {
    throw new Error("No running activities with valid dates and distances were found in this CSV.");
  }
  return { runs, activities, unit };
}
