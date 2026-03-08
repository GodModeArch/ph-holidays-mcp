import type { HolidayRecord, HolidayType, YearMeta, YearIndex, LongWeekendWindow } from "./types";
import { kvKey, kvDateKey, kvMetaKey, KV_INDEX_KEY } from "./types";
import type { ApiMeta } from "./response";
import { buildMeta, wrapResponse } from "./response";

export interface KVGet {
	get(key: string): Promise<string | null>;
}

export interface ToolResult {
	[key: string]: unknown;
	content: { type: "text"; text: string }[];
	isError?: boolean;
}

function errorResult(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

function jsonResult<T>(data: T): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function getYearMeta(kv: KVGet, year: number): Promise<YearMeta | null> {
	const raw = await kv.get(kvMetaKey(year));
	return raw ? (JSON.parse(raw) as YearMeta) : null;
}

async function getIndex(kv: KVGet): Promise<YearIndex | null> {
	const raw = await kv.get(KV_INDEX_KEY);
	return raw ? (JSON.parse(raw) as YearIndex) : null;
}

async function getHolidaysArray(kv: KVGet, year: number): Promise<HolidayRecord[] | null> {
	const raw = await kv.get(kvKey(year));
	return raw ? (JSON.parse(raw) as HolidayRecord[]) : null;
}

function getCurrentYear(): number {
	const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
	return parseInt(formatter.format(new Date()).split("-")[0], 10);
}

function getTodayPH(): string {
	const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
	return formatter.format(new Date());
}

// ── Tool 1: get_holidays ──────────────────────────────────────────

export async function handleGetHolidays(
	args: { year?: number; type?: HolidayType },
	kv: KVGet,
): Promise<ToolResult> {
	const year = args.year ?? getCurrentYear();

	const meta = await getYearMeta(kv, year);
	if (!meta) {
		return errorResult(`No holiday data available for year ${year}. Only current and next year are supported.`);
	}

	const holidays = await getHolidaysArray(kv, year);
	if (!holidays) {
		return errorResult(`Holiday data not found for year ${year}.`);
	}

	const filtered = args.type ? holidays.filter((h) => h.type === args.type) : holidays;

	return jsonResult(wrapResponse(filtered, buildMeta(meta)));
}

// ── Tool 2: get_holiday_by_date ───────────────────────────────────

export async function handleGetHolidayByDate(
	args: { date: string },
	kv: KVGet,
): Promise<ToolResult> {
	const year = parseInt(args.date.split("-")[0], 10);
	if (isNaN(year)) {
		return errorResult(`Invalid date format: ${args.date}. Use YYYY-MM-DD.`);
	}

	const meta = await getYearMeta(kv, year);
	if (!meta) {
		return errorResult(`No holiday data available for year ${year}.`);
	}

	const raw = await kv.get(kvDateKey(year, args.date));
	if (raw) {
		const holiday: HolidayRecord = JSON.parse(raw);
		const isWorkingDay = holiday.type === "special_working";
		return jsonResult(
			wrapResponse(
				{
					is_holiday: true,
					is_working_day: isWorkingDay,
					holiday,
				},
				buildMeta(meta),
			),
		);
	}

	return jsonResult(
		wrapResponse(
			{
				is_holiday: false,
				is_working_day: true,
				holiday: null,
			},
			buildMeta(meta),
		),
	);
}

// ── Tool 3: get_upcoming_holidays ─────────────────────────────────

export async function handleGetUpcomingHolidays(
	args: { from_date?: string; limit?: number; type?: HolidayType },
	kv: KVGet,
): Promise<ToolResult> {
	const fromDate = args.from_date ?? getTodayPH();
	const limit = Math.min(args.limit ?? 5, 20);
	const fromYear = parseInt(fromDate.split("-")[0], 10);

	if (isNaN(fromYear)) {
		return errorResult(`Invalid date format: ${fromDate}. Use YYYY-MM-DD.`);
	}

	const upcoming: HolidayRecord[] = [];

	// Load current year holidays
	const currentHolidays = await getHolidaysArray(kv, fromYear);
	const currentMeta = await getYearMeta(kv, fromYear);
	if (!currentMeta) {
		return errorResult(`No holiday data available for year ${fromYear}.`);
	}

	if (currentHolidays) {
		for (const h of currentHolidays) {
			if (h.date >= fromDate && (!args.type || h.type === args.type)) {
				upcoming.push(h);
			}
			if (upcoming.length >= limit) break;
		}
	}

	// Cross into next year if needed
	if (upcoming.length < limit) {
		const nextYear = fromYear + 1;
		const nextHolidays = await getHolidaysArray(kv, nextYear);
		if (nextHolidays) {
			for (const h of nextHolidays) {
				if (!args.type || h.type === args.type) {
					upcoming.push(h);
				}
				if (upcoming.length >= limit) break;
			}
		}
	}

	return jsonResult(wrapResponse(upcoming.slice(0, limit), buildMeta(currentMeta)));
}

// ── Tool 4: is_working_day ────────────────────────────────────────

export async function handleIsWorkingDay(
	args: { date: string },
	kv: KVGet,
): Promise<ToolResult> {
	const year = parseInt(args.date.split("-")[0], 10);
	if (isNaN(year)) {
		return errorResult(`Invalid date format: ${args.date}. Use YYYY-MM-DD.`);
	}

	const meta = await getYearMeta(kv, year);
	if (!meta) {
		return errorResult(`No holiday data available for year ${year}.`);
	}

	const raw = await kv.get(kvDateKey(year, args.date));
	if (raw) {
		const holiday: HolidayRecord = JSON.parse(raw);
		const isWorking = holiday.type === "special_working";
		const reason = isWorking
			? `Special Working Day: ${holiday.name}`
			: `${holiday.type === "regular" ? "Regular Holiday" : holiday.type === "islamic" ? "Islamic Holiday" : "Special Non-Working Day"}: ${holiday.name}`;

		return jsonResult(
			wrapResponse(
				{
					date: args.date,
					is_working_day: isWorking,
					reason,
					holiday_type: holiday.type,
				},
				buildMeta(meta),
			),
		);
	}

	return jsonResult(
		wrapResponse(
			{
				date: args.date,
				is_working_day: true,
				reason: "No holiday on this date",
				holiday_type: null,
			},
			buildMeta(meta),
		),
	);
}

// ── Tool 5: get_long_weekends ─────────────────────────────────────

export async function handleGetLongWeekends(
	args: { year?: number },
	kv: KVGet,
): Promise<ToolResult> {
	const year = args.year ?? getCurrentYear();

	const meta = await getYearMeta(kv, year);
	if (!meta) {
		return errorResult(`No holiday data available for year ${year}.`);
	}

	const holidays = await getHolidaysArray(kv, year);
	if (!holidays) {
		return errorResult(`Holiday data not found for year ${year}.`);
	}

	const windows = computeLongWeekends(holidays, year);

	return jsonResult(wrapResponse({ long_weekends: windows }, buildMeta(meta)));
}

// ── Long weekend computation ──────────────────────────────────────

function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number): string {
	const d = new Date(dateStr + "T12:00:00Z");
	d.setUTCDate(d.getUTCDate() + days);
	return formatDate(d);
}

function daysBetween(a: string, b: string): number {
	const da = new Date(a + "T12:00:00Z").getTime();
	const db = new Date(b + "T12:00:00Z").getTime();
	return Math.round((db - da) / 86400000);
}

function computeLongWeekends(holidays: HolidayRecord[], year: number): LongWeekendWindow[] {
	const nonWorking = new Set<string>();
	const holidayMap = new Map<string, HolidayRecord[]>();

	// Add all weekends for the year
	const d = new Date(Date.UTC(year, 0, 1, 12));
	while (d.getUTCFullYear() === year) {
		const dow = d.getUTCDay();
		if (dow === 0 || dow === 6) {
			nonWorking.add(formatDate(d));
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

	function addWindow(dates: string[], bridgeDays: number) {
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
			addWindow(cluster, 0);
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
				addWindow(merged, gap);
			}
		}
	}

	// Triple-cluster bridge (gap1=1, gap2=1 for total bridge=2)
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
				addWindow(merged, gap1 + gap2);
			}
		}
	}

	return windows.sort((a, b) => a.window_start.localeCompare(b.window_start));
}
