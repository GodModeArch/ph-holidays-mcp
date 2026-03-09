import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import {
	handleGetHolidays,
	handleGetHolidayByDate,
	handleGetUpcomingHolidays,
	handleIsWorkingDay,
	handleGetLongWeekends,
	type KVGet,
} from "../src/tool-handlers";

// ── Mock KV ───────────────────────────────────────────────────────

class MockKV implements KVGet {
	private store = new Map<string, string>();

	set(key: string, value: string): void {
		this.store.set(key, value);
	}

	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}
}

// ── Test fixtures ─────────────────────────────────────────────────

const testMeta = {
	year: 2026,
	tier: "current" as const,
	proclamation: "No. 1006",
	signed_by: "Test",
	signed_date: "2025-09-03",
	published_date: "2025-09-04",
	source: "Test Source",
	source_url: "https://example.com",
	dole_advisory: "Test Advisory",
	eid_fitr_status: "pending" as const,
	eid_adha_status: "pending" as const,
	last_updated: "2026-01-01",
	total_holidays: 5,
	breakdown: { regular: 2, special_non_working: 1, special_working: 1, islamic: 1 },
};

const nextYearMeta = { ...testMeta, year: 2027, tier: "next" as const };

const source = {
	proclamation: "No. 1006",
	signed_date: "2025-09-03",
	authority: "Office of the President",
};

const noLongWeekend = {
	is_part_of: false,
	window_start: null,
	window_end: null,
	days: 0,
	leave_days_needed: 0,
	dates: [],
};

const regularHoliday = {
	date: "2026-01-01",
	name: "New Year's Day",
	type: "regular" as const,
	day_of_week: "Thursday",
	movable: false,
	double_holiday: false,
	double_holiday_names: null,
	long_weekend: {
		is_part_of: true,
		window_start: "2026-01-01",
		window_end: "2026-01-04",
		days: 4,
		leave_days_needed: 1,
		dates: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
	},
	source,
	notes: null,
};

const specialWorkingHoliday = {
	date: "2026-02-25",
	name: "EDSA People Power Revolution Anniversary",
	type: "special_working" as const,
	day_of_week: "Wednesday",
	movable: false,
	double_holiday: false,
	double_holiday_names: null,
	long_weekend: noLongWeekend,
	source,
	notes: null,
};

const islamicHoliday = {
	date: "2026-03-20",
	name: "Eid'l Fitr",
	type: "islamic" as const,
	day_of_week: "Friday",
	movable: true,
	double_holiday: false,
	double_holiday_names: null,
	long_weekend: {
		is_part_of: true,
		window_start: "2026-03-20",
		window_end: "2026-03-22",
		days: 3,
		leave_days_needed: 0,
		dates: ["2026-03-20", "2026-03-21", "2026-03-22"],
	},
	source,
	notes: "Date to be confirmed",
	eid_confirmed: false,
	estimated_date: "2026-03-20",
	confirmed_date: null,
	proclamation_ref: null,
};

const specialNonWorkingHoliday = {
	date: "2026-04-04",
	name: "Black Saturday",
	type: "special_non_working" as const,
	day_of_week: "Saturday",
	movable: false,
	double_holiday: false,
	double_holiday_names: null,
	long_weekend: noLongWeekend,
	source,
	notes: null,
};

const decemberHoliday = {
	date: "2026-12-25",
	name: "Christmas Day",
	type: "regular" as const,
	day_of_week: "Friday",
	movable: false,
	double_holiday: false,
	double_holiday_names: null,
	long_weekend: noLongWeekend,
	source,
	notes: null,
};

const nextYearHoliday = {
	date: "2027-01-01",
	name: "New Year's Day",
	type: "regular" as const,
	day_of_week: "Friday",
	movable: false,
	double_holiday: false,
	double_holiday_names: null,
	long_weekend: noLongWeekend,
	source,
	notes: null,
};

const testHolidays = [
	regularHoliday,
	specialWorkingHoliday,
	islamicHoliday,
	specialNonWorkingHoliday,
	decemberHoliday,
];

const testLongWeekends = [
	{
		window_start: "2026-01-01",
		window_end: "2026-01-04",
		days: 4,
		holidays_included: ["New Year's Day"],
		leave_days_needed: 1,
		dates: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
	},
	{
		window_start: "2026-03-20",
		window_end: "2026-03-22",
		days: 3,
		holidays_included: ["Eid'l Fitr"],
		leave_days_needed: 0,
		dates: ["2026-03-20", "2026-03-21", "2026-03-22"],
	},
];

function createSeededKV(): MockKV {
	const kv = new MockKV();

	// 2026 data
	kv.set("holidays:2026", JSON.stringify(testHolidays));
	kv.set("holidays:2026:meta", JSON.stringify(testMeta));
	kv.set("holidays:2026:long_weekends", JSON.stringify(testLongWeekends));
	kv.set("holidays:2026:date:2026-01-01", JSON.stringify(regularHoliday));
	kv.set("holidays:2026:date:2026-02-25", JSON.stringify(specialWorkingHoliday));
	kv.set("holidays:2026:date:2026-03-20", JSON.stringify(islamicHoliday));
	kv.set("holidays:2026:date:2026-04-04", JSON.stringify(specialNonWorkingHoliday));
	kv.set("holidays:2026:date:2026-12-25", JSON.stringify(decemberHoliday));

	// 2027 data (for cross-year tests)
	kv.set("holidays:2027", JSON.stringify([nextYearHoliday]));
	kv.set("holidays:2027:meta", JSON.stringify(nextYearMeta));

	return kv;
}

function parseResult(result: { content: { type: string; text: string }[]; isError?: boolean }) {
	return JSON.parse(result.content[0].text);
}

// ── Tests ─────────────────────────────────────────────────────────

describe("handleGetHolidays", () => {
	let kv: MockKV;
	beforeEach(() => {
		kv = createSeededKV();
	});

	it("returns all holidays for a year", async () => {
		const result = await handleGetHolidays({ year: 2026 }, kv);
		assert.equal(result.isError, undefined);
		const data = parseResult(result);
		assert.equal(data.data.length, 5);
		assert.equal(data._meta.year, 2026);
	});

	it("filters by type", async () => {
		const result = await handleGetHolidays({ year: 2026, type: "regular" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.length, 2);
		assert.ok(data.data.every((h: { type: string }) => h.type === "regular"));
	});

	it("filters by islamic type", async () => {
		const result = await handleGetHolidays({ year: 2026, type: "islamic" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.length, 1);
		assert.equal(data.data[0].name, "Eid'l Fitr");
	});

	it("returns empty array when filtering by type with no matches", async () => {
		// All 5 holidays exist but none match a filter after removing them
		const kv2 = new MockKV();
		kv2.set("holidays:2026:meta", JSON.stringify(testMeta));
		kv2.set("holidays:2026", JSON.stringify([regularHoliday]));
		const result = await handleGetHolidays({ year: 2026, type: "islamic" }, kv2);
		const data = parseResult(result);
		assert.equal(data.data.length, 0);
	});

	it("returns error for unavailable year", async () => {
		const result = await handleGetHolidays({ year: 2020 }, kv);
		assert.equal(result.isError, true);
		assert.ok(result.content[0].text.includes("2020"));
	});
});

describe("handleGetHolidayByDate", () => {
	let kv: MockKV;
	beforeEach(() => {
		kv = createSeededKV();
	});

	it("returns holiday record for a known holiday", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-01-01" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_holiday, true);
		assert.equal(data.data.is_working_day, false);
		assert.equal(data.data.holidays.length, 1);
		assert.equal(data.data.holidays[0].name, "New Year's Day");
	});

	it("returns is_working_day true for special_working holidays", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-02-25" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_holiday, true);
		assert.equal(data.data.is_working_day, true);
		assert.equal(data.data.holidays[0].type, "special_working");
	});

	it("returns no holiday for a regular date", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-06-15" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_holiday, false);
		assert.equal(data.data.is_working_day, true);
		assert.equal(data.data.holidays.length, 0);
	});

	it("handles double holidays stored as array", async () => {
		const doubleA = { ...regularHoliday, date: "2026-05-01", name: "Labor Day", double_holiday: true, double_holiday_names: ["Labor Day", "Test Day"] };
		const doubleB = { ...specialNonWorkingHoliday, date: "2026-05-01", name: "Test Day", double_holiday: true, double_holiday_names: ["Labor Day", "Test Day"] };
		kv.set("holidays:2026:date:2026-05-01", JSON.stringify([doubleA, doubleB]));

		const result = await handleGetHolidayByDate({ date: "2026-05-01" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_holiday, true);
		assert.equal(data.data.holidays.length, 2);
		assert.equal(data.data.is_working_day, false); // regular holiday makes it non-working
	});

	it("handles legacy single-object KV format", async () => {
		// Single object (not array) - backward compat
		const result = await handleGetHolidayByDate({ date: "2026-01-01" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.holidays.length, 1); // wrapped in array
	});

	it("rejects invalid date format", async () => {
		const result = await handleGetHolidayByDate({ date: "not-a-date" }, kv);
		assert.equal(result.isError, true);
		assert.ok(result.content[0].text.includes("Invalid date"));
	});

	it("rejects impossible date Feb 31", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-02-31" }, kv);
		assert.equal(result.isError, true);
		assert.ok(result.content[0].text.includes("Invalid date"));
	});

	it("rejects impossible date Feb 29 in non-leap year", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-02-29" }, kv);
		assert.equal(result.isError, true);
	});

	it("rejects month 13", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-13-01" }, kv);
		assert.equal(result.isError, true);
	});

	it("rejects month 00", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-00-15" }, kv);
		assert.equal(result.isError, true);
	});

	it("rejects day 00", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-06-00" }, kv);
		assert.equal(result.isError, true);
	});

	it("rejects short format", async () => {
		const result = await handleGetHolidayByDate({ date: "2026-1-1" }, kv);
		assert.equal(result.isError, true);
	});

	it("returns error for year with no data", async () => {
		const result = await handleGetHolidayByDate({ date: "2020-01-01" }, kv);
		assert.equal(result.isError, true);
		assert.ok(result.content[0].text.includes("2020"));
	});
});

describe("handleIsWorkingDay", () => {
	let kv: MockKV;
	beforeEach(() => {
		kv = createSeededKV();
	});

	it("regular holiday is not a working day", async () => {
		const result = await handleIsWorkingDay({ date: "2026-01-01" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_working_day, false);
		assert.ok(data.data.reason.includes("Regular Holiday"));
		assert.ok(data.data.reason.includes("New Year's Day"));
		assert.equal(data.data.holiday_type, "regular");
	});

	it("special_working holiday IS a working day", async () => {
		const result = await handleIsWorkingDay({ date: "2026-02-25" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_working_day, true);
		assert.ok(data.data.reason.includes("Special Working Day"));
		assert.equal(data.data.holiday_type, "special_working");
	});

	it("islamic holiday is not a working day", async () => {
		const result = await handleIsWorkingDay({ date: "2026-03-20" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_working_day, false);
		assert.ok(data.data.reason.includes("Islamic Holiday"));
		assert.equal(data.data.holiday_type, "islamic");
	});

	it("special_non_working holiday is not a working day", async () => {
		const result = await handleIsWorkingDay({ date: "2026-04-04" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_working_day, false);
		assert.ok(data.data.reason.includes("Special Non-Working Day"));
	});

	it("non-holiday date is a working day", async () => {
		const result = await handleIsWorkingDay({ date: "2026-06-15" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_working_day, true);
		assert.equal(data.data.reason, "No holiday on this date");
		assert.equal(data.data.holiday_type, null);
	});

	it("double holiday: non-working wins over working", async () => {
		const working = { ...specialWorkingHoliday, date: "2026-07-04", name: "Working Holiday" };
		const nonWorking = { ...regularHoliday, date: "2026-07-04", name: "Regular Holiday" };
		kv.set("holidays:2026:date:2026-07-04", JSON.stringify([working, nonWorking]));

		const result = await handleIsWorkingDay({ date: "2026-07-04" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_working_day, false);
		assert.ok(data.data.reason.includes("Regular Holiday"));
	});

	it("double holiday: both working stays working", async () => {
		const w1 = { ...specialWorkingHoliday, date: "2026-07-04", name: "Working A" };
		const w2 = { ...specialWorkingHoliday, date: "2026-07-04", name: "Working B" };
		kv.set("holidays:2026:date:2026-07-04", JSON.stringify([w1, w2]));

		const result = await handleIsWorkingDay({ date: "2026-07-04" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.is_working_day, true);
		assert.ok(data.data.reason.includes("Working A"));
		assert.ok(data.data.reason.includes("Working B"));
	});

	it("rejects invalid dates", async () => {
		const result = await handleIsWorkingDay({ date: "2026-02-31" }, kv);
		assert.equal(result.isError, true);
	});
});

describe("handleGetUpcomingHolidays", () => {
	let kv: MockKV;
	beforeEach(() => {
		kv = createSeededKV();
	});

	it("returns upcoming holidays from a date", async () => {
		const result = await handleGetUpcomingHolidays({ from_date: "2026-01-01", limit: 3 }, kv);
		const data = parseResult(result);
		assert.equal(data.data.length, 3);
		assert.equal(data.data[0].date, "2026-01-01"); // inclusive of from_date
		assert.equal(data.data[1].date, "2026-02-25");
		assert.equal(data.data[2].date, "2026-03-20");
	});

	it("respects limit parameter", async () => {
		const result = await handleGetUpcomingHolidays({ from_date: "2026-01-01", limit: 2 }, kv);
		const data = parseResult(result);
		assert.equal(data.data.length, 2);
	});

	it("defaults limit to 5", async () => {
		const result = await handleGetUpcomingHolidays({ from_date: "2026-01-01" }, kv);
		const data = parseResult(result);
		assert.equal(data.data.length, 5); // all 5 test holidays
	});

	it("caps limit at 20", async () => {
		// Even if more than 20 holidays exist, limit is capped
		const result = await handleGetUpcomingHolidays({ from_date: "2026-01-01", limit: 100 }, kv);
		const data = parseResult(result);
		assert.ok(data.data.length <= 20);
	});

	it("filters by type", async () => {
		const result = await handleGetUpcomingHolidays(
			{ from_date: "2026-01-01", type: "regular", limit: 10 },
			kv,
		);
		const data = parseResult(result);
		assert.ok(data.data.every((h: { type: string }) => h.type === "regular"));
		assert.equal(data.data.length, 3); // New Year's 2026 + Christmas 2026 + New Year's 2027
	});

	it("crosses into next year when needed", async () => {
		const result = await handleGetUpcomingHolidays(
			{ from_date: "2026-12-26", limit: 5 },
			kv,
		);
		const data = parseResult(result);
		assert.ok(data.data.length >= 1);
		// Should include 2027 holiday
		const has2027 = data.data.some((h: { date: string }) => h.date.startsWith("2027"));
		assert.ok(has2027, "Should include holidays from next year");
	});

	it("returns empty when all holidays are past", async () => {
		const result = await handleGetUpcomingHolidays({ from_date: "2026-12-31" }, kv);
		const data = parseResult(result);
		// Only 2027 holidays should be returned (crosses year boundary)
		for (const h of data.data) {
			assert.ok(h.date >= "2026-12-31");
		}
	});

	it("rejects invalid from_date", async () => {
		const result = await handleGetUpcomingHolidays({ from_date: "2026-02-31" }, kv);
		assert.equal(result.isError, true);
	});

	it("returns error for year with no data", async () => {
		const result = await handleGetUpcomingHolidays({ from_date: "2020-01-01" }, kv);
		assert.equal(result.isError, true);
	});

	it("from_date is inclusive", async () => {
		const result = await handleGetUpcomingHolidays({ from_date: "2026-03-20", limit: 1 }, kv);
		const data = parseResult(result);
		assert.equal(data.data[0].date, "2026-03-20");
		assert.equal(data.data[0].name, "Eid'l Fitr");
	});
});

describe("handleGetLongWeekends", () => {
	let kv: MockKV;
	beforeEach(() => {
		kv = createSeededKV();
	});

	it("returns precomputed long weekend windows", async () => {
		const result = await handleGetLongWeekends({ year: 2026 }, kv);
		const data = parseResult(result);
		assert.equal(data.data.long_weekends.length, 2);
		assert.equal(data.data.long_weekends[0].window_start, "2026-01-01");
		assert.equal(data.data.long_weekends[0].leave_days_needed, 1);
	});

	it("returns error for unavailable year", async () => {
		const result = await handleGetLongWeekends({ year: 2020 }, kv);
		assert.equal(result.isError, true);
	});

	it("returns error when long weekends key is missing", async () => {
		const kv2 = new MockKV();
		kv2.set("holidays:2026:meta", JSON.stringify(testMeta));
		// No long_weekends key set
		const result = await handleGetLongWeekends({ year: 2026 }, kv2);
		assert.equal(result.isError, true);
		assert.ok(result.content[0].text.includes("Long weekend data not found"));
	});

	it("includes metadata in response", async () => {
		const result = await handleGetLongWeekends({ year: 2026 }, kv);
		const data = parseResult(result);
		assert.equal(data._meta.year, 2026);
		assert.equal(data._meta.proclamation, "No. 1006");
	});
});

describe("response envelope", () => {
	it("all successful responses include _meta", async () => {
		const kv = createSeededKV();

		const r1 = await handleGetHolidays({ year: 2026 }, kv);
		assert.ok(parseResult(r1)._meta);

		const r2 = await handleGetHolidayByDate({ date: "2026-01-01" }, kv);
		assert.ok(parseResult(r2)._meta);

		const r3 = await handleIsWorkingDay({ date: "2026-01-01" }, kv);
		assert.ok(parseResult(r3)._meta);

		const r4 = await handleGetLongWeekends({ year: 2026 }, kv);
		assert.ok(parseResult(r4)._meta);
	});

	it("error responses have isError flag", async () => {
		const kv = createSeededKV();

		const r1 = await handleGetHolidays({ year: 1999 }, kv);
		assert.equal(r1.isError, true);

		const r2 = await handleGetHolidayByDate({ date: "invalid" }, kv);
		assert.equal(r2.isError, true);
	});
});
