export type HolidayType = "regular" | "special_non_working" | "special_working" | "islamic";

export interface LongWeekendInfo {
	is_part_of: boolean;
	window_start: string | null;
	window_end: string | null;
	days: number;
	leave_days_needed: number;
	dates: string[];
}

export interface HolidaySource {
	proclamation: string;
	signed_date: string;
	authority: string;
}

export interface BaseHolidayRecord {
	date: string;
	name: string;
	type: HolidayType;
	day_of_week: string;
	movable: boolean;
	double_holiday: boolean;
	double_holiday_names: string[] | null;
	long_weekend: LongWeekendInfo;
	source: HolidaySource;
	notes: string | null;
}

export interface IslamicHolidayRecord extends BaseHolidayRecord {
	type: "islamic";
	eid_confirmed: boolean;
	estimated_date: string;
	confirmed_date: string | null;
	proclamation_ref: string | null;
}

export type HolidayRecord = BaseHolidayRecord | IslamicHolidayRecord;

export interface LongWeekendWindow {
	window_start: string;
	window_end: string;
	days: number;
	holidays_included: string[];
	leave_days_needed: number;
	dates: string[];
}

export interface YearMeta {
	year: number;
	tier: "current" | "next";
	proclamation: string;
	signed_by: string;
	signed_date: string;
	published_date: string;
	source: string;
	source_url: string;
	dole_advisory: string;
	eid_fitr_status: "pending" | "confirmed";
	eid_adha_status: "pending" | "confirmed";
	last_updated: string;
	total_holidays: number;
	breakdown: {
		regular: number;
		special_non_working: number;
		special_working: number;
		islamic: number;
	};
}

export interface YearIndex {
	years: { year: number; tier: "current" | "next" }[];
	current_year: number;
	last_updated: string;
}

export const KV_PREFIX = {
	holidays: "holidays",
} as const;

export function kvKey(year: number): string {
	return `${KV_PREFIX.holidays}:${year}`;
}

export function kvDateKey(year: number, date: string): string {
	return `${KV_PREFIX.holidays}:${year}:date:${date}`;
}

export function kvMetaKey(year: number): string {
	return `${KV_PREFIX.holidays}:${year}:meta`;
}

export const KV_INDEX_KEY = "holidays:index";
