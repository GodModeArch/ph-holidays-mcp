import type { HolidayRecord, HolidayType, YearMeta, LongWeekendWindow } from "./types";
import { kvKey, kvDateKey, kvMetaKey, kvLongWeekendsKey } from "./types";
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

async function getHolidaysArray(kv: KVGet, year: number): Promise<HolidayRecord[] | null> {
	const raw = await kv.get(kvKey(year));
	return raw ? (JSON.parse(raw) as HolidayRecord[]) : null;
}

function isValidDate(dateStr: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
	const [y, m, d] = dateStr.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d, 12));
	return (
		date.getUTCFullYear() === y &&
		date.getUTCMonth() === m - 1 &&
		date.getUTCDate() === d
	);
}

function getCurrentYear(): number {
	const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
	return parseInt(formatter.format(new Date()).split("-")[0], 10);
}

function getTodayPH(): string {
	const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });
	return formatter.format(new Date());
}

function parseHolidaysFromKV(raw: string): HolidayRecord[] {
	const parsed = JSON.parse(raw);
	return Array.isArray(parsed) ? parsed : [parsed];
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
	if (!isValidDate(args.date)) {
		return errorResult(`Invalid date: ${args.date}. Use a valid YYYY-MM-DD date.`);
	}

	const year = parseInt(args.date.split("-")[0], 10);

	const meta = await getYearMeta(kv, year);
	if (!meta) {
		return errorResult(`No holiday data available for year ${year}.`);
	}

	const raw = await kv.get(kvDateKey(year, args.date));
	if (raw) {
		const holidays = parseHolidaysFromKV(raw);
		const isWorkingDay = holidays.every((h) => h.type === "special_working");
		return jsonResult(
			wrapResponse(
				{
					is_holiday: true,
					is_working_day: isWorkingDay,
					holidays,
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
				holidays: [],
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
	if (args.from_date && !isValidDate(args.from_date)) {
		return errorResult(`Invalid date: ${args.from_date}. Use a valid YYYY-MM-DD date.`);
	}

	const fromDate = args.from_date ?? getTodayPH();
	const limit = Math.min(args.limit ?? 5, 20);
	const fromYear = parseInt(fromDate.split("-")[0], 10);

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
	if (!isValidDate(args.date)) {
		return errorResult(`Invalid date: ${args.date}. Use a valid YYYY-MM-DD date.`);
	}

	const year = parseInt(args.date.split("-")[0], 10);

	const meta = await getYearMeta(kv, year);
	if (!meta) {
		return errorResult(`No holiday data available for year ${year}.`);
	}

	const raw = await kv.get(kvDateKey(year, args.date));
	if (raw) {
		const holidays = parseHolidaysFromKV(raw);
		const isWorking = holidays.every((h) => h.type === "special_working");

		let reason: string;
		if (isWorking) {
			reason = `Special Working Day: ${holidays.map((h) => h.name).join(", ")}`;
		} else {
			reason = holidays
				.filter((h) => h.type !== "special_working")
				.map((h) => {
					const label =
						h.type === "regular"
							? "Regular Holiday"
							: h.type === "islamic"
								? "Islamic Holiday"
								: "Special Non-Working Day";
					return `${label}: ${h.name}`;
				})
				.join("; ");
		}

		return jsonResult(
			wrapResponse(
				{
					date: args.date,
					is_working_day: isWorking,
					reason,
					holiday_type: holidays[0].type,
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

	const raw = await kv.get(kvLongWeekendsKey(year));
	if (!raw) {
		return errorResult(`Long weekend data not found for year ${year}.`);
	}

	const windows: LongWeekendWindow[] = JSON.parse(raw);
	return jsonResult(wrapResponse({ long_weekends: windows }, buildMeta(meta)));
}
