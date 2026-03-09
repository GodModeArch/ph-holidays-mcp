/**
 * Shared long weekend computation.
 * Used by seed, patch-eid, and patch-holiday scripts.
 */

import type { LongWeekendInfo, LongWeekendWindow } from "../../src/types";

export interface HolidayInput {
	date: string;
	name: string;
	type: string;
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatDateUTC(d: Date): string {
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function getDayOfWeek(dateStr: string): string {
	const d = new Date(dateStr + "T12:00:00Z");
	return DAYS_OF_WEEK[d.getUTCDay()];
}

export function addDays(dateStr: string, days: number): string {
	const d = new Date(dateStr + "T12:00:00Z");
	d.setUTCDate(d.getUTCDate() + days);
	return formatDateUTC(d);
}

export function daysBetween(a: string, b: string): number {
	const da = new Date(a + "T12:00:00Z").getTime();
	const db = new Date(b + "T12:00:00Z").getTime();
	return Math.round((db - da) / 86400000);
}

export function computeLongWeekends(holidays: HolidayInput[], year: number): LongWeekendWindow[] {
	const nonWorking = new Set<string>();
	const holidayMap = new Map<string, HolidayInput[]>();

	// Add all weekends for the year
	const d = new Date(Date.UTC(year, 0, 1, 12));
	while (d.getUTCFullYear() === year) {
		const dow = d.getUTCDay();
		if (dow === 0 || dow === 6) {
			nonWorking.add(formatDateUTC(d));
		}
		d.setUTCDate(d.getUTCDate() + 1);
	}

	// Add non-working holidays
	for (const h of holidays) {
		if (h.type !== "special_working") {
			nonWorking.add(h.date);
			const existing = holidayMap.get(h.date) || [];
			existing.push(h);
			holidayMap.set(h.date, existing);
		}
	}

	// Sort and cluster consecutive non-working dates
	const sorted = [...nonWorking].sort();
	if (sorted.length === 0) return [];

	const clusters: string[][] = [];
	let current: string[] = [sorted[0]];

	for (let i = 1; i < sorted.length; i++) {
		const diff = daysBetween(sorted[i - 1], sorted[i]);
		if (diff === 1) {
			current.push(sorted[i]);
		} else {
			clusters.push(current);
			current = [sorted[i]];
		}
	}
	clusters.push(current);

	const windows: LongWeekendWindow[] = [];
	const seen = new Set<string>();

	function tryAddWindow(dates: string[], bridgeDays: number) {
		const key = `${dates[0]}|${dates[dates.length - 1]}`;
		if (seen.has(key)) return;

		const holidayNames: string[] = [];
		for (const dt of dates) {
			const hs = holidayMap.get(dt);
			if (hs) {
				for (const h of hs) holidayNames.push(h.name);
			}
		}
		if (holidayNames.length === 0) return;

		seen.add(key);
		windows.push({
			window_start: dates[0],
			window_end: dates[dates.length - 1],
			days: dates.length,
			holidays_included: holidayNames,
			leave_days_needed: bridgeDays,
			dates: [...dates],
		});
	}

	// Natural long weekends (3+ consecutive non-working days)
	for (const cluster of clusters) {
		if (cluster.length >= 3) {
			tryAddWindow(cluster, 0);
		}
	}

	// Bridge windows (1-2 day gap between adjacent clusters)
	for (let i = 0; i < clusters.length - 1; i++) {
		const c1 = clusters[i];
		const c2 = clusters[i + 1];
		const gap = daysBetween(c1[c1.length - 1], c2[0]) - 1;

		if (gap >= 1 && gap <= 2) {
			const merged = [...c1];
			for (let g = 1; g <= gap; g++) {
				merged.push(addDays(c1[c1.length - 1], g));
			}
			merged.push(...c2);
			if (merged.length >= 3) {
				tryAddWindow(merged, gap);
			}
		}
	}

	// Triple-cluster bridge (gap1 + gap2 <= 2)
	for (let i = 0; i < clusters.length - 2; i++) {
		const c1 = clusters[i];
		const c2 = clusters[i + 1];
		const c3 = clusters[i + 2];
		const gap1 = daysBetween(c1[c1.length - 1], c2[0]) - 1;
		const gap2 = daysBetween(c2[c2.length - 1], c3[0]) - 1;

		if (gap1 >= 1 && gap2 >= 1 && gap1 + gap2 <= 2) {
			const merged = [...c1];
			for (let g = 1; g <= gap1; g++) {
				merged.push(addDays(c1[c1.length - 1], g));
			}
			merged.push(...c2);
			for (let g = 1; g <= gap2; g++) {
				merged.push(addDays(c2[c2.length - 1], g));
			}
			merged.push(...c3);
			if (merged.length >= 3) {
				tryAddWindow(merged, gap1 + gap2);
			}
		}
	}

	return windows.sort((a, b) => a.window_start.localeCompare(b.window_start));
}

export function buildLongWeekendInfo(
	holidayDate: string,
	windows: LongWeekendWindow[],
): LongWeekendInfo {
	const matching = windows.filter((w) => w.dates.includes(holidayDate));

	if (matching.length === 0) {
		return {
			is_part_of: false,
			window_start: null,
			window_end: null,
			days: 0,
			leave_days_needed: 0,
			dates: [],
		};
	}

	// Prefer natural (0 bridge days), then smallest window
	matching.sort((a, b) => {
		if (a.leave_days_needed !== b.leave_days_needed)
			return a.leave_days_needed - b.leave_days_needed;
		return a.days - b.days;
	});

	const best = matching[0];
	return {
		is_part_of: true,
		window_start: best.window_start,
		window_end: best.window_end,
		days: best.days,
		leave_days_needed: best.leave_days_needed,
		dates: best.dates,
	};
}
