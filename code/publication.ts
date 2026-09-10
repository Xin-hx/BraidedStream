export interface PublicationEvent {
  seam: number;
  start: number;
  peak: number;
  end: number;
  height: number;
}

export interface CalmRegion {
  edge: "start" | "end";
  start: number;
  end: number;
}

/** Select the strongest 2-3 temporally distinct local separation windows. */
export function selectPublicationEvents(seams: number[][], limit = 3): PublicationEvent[] {
  if (seams.length === 0 || seams[0].length === 0) return [];
  const tLen = seams[0].length;
  const candidates: PublicationEvent[] = [];
  for (let seam = 0; seam < seams.length; seam += 1) {
    let start = -1;
    for (let t = 0; t <= tLen; t += 1) {
      const active = t < tLen && seams[seam][t] > 1e-12;
      if (active && start < 0) start = t;
      if (!active && start >= 0) {
        let peak = start;
        for (let k = start + 1; k < t; k += 1) if (seams[seam][k] > seams[seam][peak]) peak = k;
        candidates.push({ seam, start, peak, end: t - 1, height: seams[seam][peak] });
        start = -1;
      }
    }
  }

  const separation = Math.max(8, Math.round(tLen * 0.14));
  const selected: PublicationEvent[] = [];
  for (const event of candidates.sort((a, b) => b.height - a.height || a.peak - b.peak)) {
    if (selected.every((other) => Math.abs(other.peak - event.peak) >= separation)) {
      selected.push(event);
      if (selected.length === limit) break;
    }
  }
  return selected.sort((a, b) => a.peak - b.peak);
}

/** Exact calm regions shared by every seam at the leading/trailing edges. */
export function publicationCalmRegions(seams: number[][]): CalmRegion[] {
  if (seams.length === 0 || seams[0].length === 0) return [];
  const tLen = seams[0].length;
  const activeAt = (t: number): boolean => seams.some((row) => row[t] > 1e-12);
  let first = 0;
  while (first < tLen && !activeAt(first)) first += 1;
  let last = tLen - 1;
  while (last >= 0 && !activeAt(last)) last -= 1;
  if (first > last) return [{ edge: "start", start: 0, end: tLen - 1 }];
  const regions: CalmRegion[] = [];
  if (first > 0) regions.push({ edge: "start", start: 0, end: first - 1 });
  if (last < tLen - 1) regions.push({ edge: "end", start: last + 1, end: tLen - 1 });
  return regions;
}

export function publicationEventAttributes(event: PublicationEvent): Record<string, string> {
  return {
    "data-event-annotation": "true",
    "data-event-seam": String(event.seam),
    "data-event-start": String(event.start),
    "data-event-peak": String(event.peak),
    "data-event-end": String(event.end),
  };
}
