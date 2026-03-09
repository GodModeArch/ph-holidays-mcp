import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
	computeLongWeekends,
	buildLongWeekendInfo,
	getDayOfWeek,
	addDays,
	daysBetween,
	formatDateUTC,
	type HolidayInput,
} from "../scripts/lib/long-weekends";

// ── Utility function tests ────────────────────────────────────────

describe("formatDateUTC", () => {
	it("formats date as YYYY-MM-DD", () => {
		const d = new Date(Date.UTC(2026, 0, 1, 12));
		assert.equal(formatDateUTC(d), "2026-01-01");
	});

	it("pads single-digit months and days", () => {
		const d = new Date(Date.UTC(2026, 2, 5, 12));
		assert.equal(formatDateUTC(d), "2026-03-05");
	});

	it("handles December 31", () => {
		const d = new Date(Date.UTC(2026, 11, 31, 12));
		assert.equal(formatDateUTC(d), "2026-12-31");
	});
});

describe("getDayOfWeek", () => {
	it("returns correct day for known dates", () => {
		assert.equal(getDayOfWeek("2026-01-01"), "Thursday");
		assert.equal(getDayOfWeek("2026-01-03"), "Saturday");
		assert.equal(getDayOfWeek("2026-01-04"), "Sunday");
		assert.equal(getDayOfWeek("2026-01-05"), "Monday");
	});
});

describe("addDays", () => {
	it("adds positive days", () => {
		assert.equal(addDays("2026-01-01", 1), "2026-01-02");
		assert.equal(addDays("2026-01-01", 7), "2026-01-08");
	});

	it("crosses month boundary", () => {
		assert.equal(addDays("2026-01-31", 1), "2026-02-01");
	});

	it("crosses year boundary", () => {
		assert.equal(addDays("2026-12-31", 1), "2027-01-01");
	});

	it("handles zero days", () => {
		assert.equal(addDays("2026-06-15", 0), "2026-06-15");
	});
});

describe("daysBetween", () => {
	it("calculates days between two dates", () => {
		assert.equal(daysBetween("2026-01-01", "2026-01-02"), 1);
		assert.equal(daysBetween("2026-01-01", "2026-01-08"), 7);
	});

	it("returns 0 for same date", () => {
		assert.equal(daysBetween("2026-06-15", "2026-06-15"), 0);
	});

	it("returns negative for reversed dates", () => {
		assert.equal(daysBetween("2026-01-08", "2026-01-01"), -7);
	});

	it("crosses month boundary", () => {
		assert.equal(daysBetween("2026-01-30", "2026-02-02"), 3);
	});
});

// ── computeLongWeekends tests ─────────────────────────────────────

describe("computeLongWeekends", () => {
	it("detects natural 3-day weekend (holiday on Friday)", () => {
		// 2026-03-20 is a Friday. Fri + Sat + Sun = 3 days
		const holidays: HolidayInput[] = [
			{ date: "2026-03-20", name: "Friday Holiday", type: "islamic" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		const match = windows.find((w) => w.holidays_included.includes("Friday Holiday"));
		assert.ok(match, "Should find a long weekend window");
		assert.equal(match!.days, 3);
		assert.equal(match!.leave_days_needed, 0);
		assert.equal(match!.window_start, "2026-03-20");
		assert.equal(match!.window_end, "2026-03-22");
	});

	it("detects natural 3-day weekend (holiday on Monday)", () => {
		// 2026-08-31 is a Monday. Sat + Sun + Mon = 3 days
		const holidays: HolidayInput[] = [
			{ date: "2026-08-31", name: "Monday Holiday", type: "regular" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		const match = windows.find((w) => w.holidays_included.includes("Monday Holiday"));
		assert.ok(match);
		assert.equal(match!.days, 3);
		assert.equal(match!.leave_days_needed, 0);
	});

	it("detects bridge opportunity (holiday on Thursday, bridge Friday)", () => {
		// 2026-01-01 is a Thursday. Thu + bridge Fri + Sat + Sun = 4 days, 1 leave
		const holidays: HolidayInput[] = [
			{ date: "2026-01-01", name: "Thursday Holiday", type: "regular" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		const bridge = windows.find(
			(w) => w.holidays_included.includes("Thursday Holiday") && w.leave_days_needed === 1,
		);
		assert.ok(bridge, "Should find a bridge opportunity");
		assert.equal(bridge!.days, 4);
		assert.equal(bridge!.leave_days_needed, 1);
	});

	it("excludes special_working holidays from non-working days", () => {
		// 2026-02-25 is a Wednesday (special_working) - should NOT create non-working cluster
		const holidays: HolidayInput[] = [
			{ date: "2026-02-25", name: "EDSA", type: "special_working" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		const match = windows.find((w) => w.holidays_included.includes("EDSA"));
		assert.equal(match, undefined, "special_working should not create long weekends");
	});

	it("handles consecutive holidays (Holy Week)", () => {
		// Thu Apr 2 + Fri Apr 3 + Sat Apr 4 (special_non_working) + Sun Apr 5
		const holidays: HolidayInput[] = [
			{ date: "2026-04-02", name: "Maundy Thursday", type: "regular" },
			{ date: "2026-04-03", name: "Good Friday", type: "regular" },
			{ date: "2026-04-04", name: "Black Saturday", type: "special_non_working" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		const holyWeek = windows.find(
			(w) => w.holidays_included.includes("Maundy Thursday") && w.leave_days_needed === 0,
		);
		assert.ok(holyWeek, "Should detect Holy Week as natural long weekend");
		assert.equal(holyWeek!.days, 4); // Thu-Fri-Sat-Sun
		assert.deepEqual(holyWeek!.dates, [
			"2026-04-02",
			"2026-04-03",
			"2026-04-04",
			"2026-04-05",
		]);
	});

	it("handles bridge with 2-day gap", () => {
		// 2026-06-12 is a Friday (Independence Day). Sat-Sun follows.
		// Next cluster might be a Wed holiday. Tue-Wed gap = 2 days bridge
		// Actually let me construct a specific scenario:
		// Holiday on Wednesday Jun 10 + gap Thu+Fri + Sat-Sun
		// That's a 2-day gap, should be detected
		const holidays: HolidayInput[] = [
			{ date: "2026-06-10", name: "Wed Holiday", type: "regular" }, // Wednesday
		];
		const windows = computeLongWeekends(holidays, 2026);
		const bridge = windows.find(
			(w) => w.holidays_included.includes("Wed Holiday") && w.leave_days_needed === 2,
		);
		assert.ok(bridge, "Should find 2-day bridge to weekend");
		assert.equal(bridge!.days, 5); // Wed + Thu + Fri + Sat + Sun
	});

	it("returns windows sorted by start date", () => {
		const holidays: HolidayInput[] = [
			{ date: "2026-08-31", name: "August Holiday", type: "regular" },
			{ date: "2026-01-01", name: "January Holiday", type: "regular" },
			{ date: "2026-06-12", name: "June Holiday", type: "regular" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		for (let i = 1; i < windows.length; i++) {
			assert.ok(windows[i].window_start >= windows[i - 1].window_start);
		}
	});

	it("handles empty holiday list", () => {
		const windows = computeLongWeekends([], 2026);
		// Should return empty since no holidays means no holiday-containing windows
		assert.equal(windows.length, 0);
	});

	it("no duplicate windows", () => {
		const holidays: HolidayInput[] = [
			{ date: "2026-04-02", name: "Maundy Thursday", type: "regular" },
			{ date: "2026-04-03", name: "Good Friday", type: "regular" },
			{ date: "2026-04-04", name: "Black Saturday", type: "special_non_working" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		const keys = windows.map((w) => `${w.window_start}|${w.window_end}`);
		const unique = new Set(keys);
		assert.equal(keys.length, unique.size, "No duplicate windows");
	});

	it("handles double holidays on same date", () => {
		const holidays: HolidayInput[] = [
			{ date: "2026-05-01", name: "Labor Day", type: "regular" },
			{ date: "2026-05-01", name: "Another Holiday", type: "special_non_working" },
		];
		const windows = computeLongWeekends(holidays, 2026);
		const match = windows.find((w) => w.holidays_included.includes("Labor Day"));
		assert.ok(match);
		assert.ok(match!.holidays_included.includes("Another Holiday"));
	});
});

// ── buildLongWeekendInfo tests ────────────────────────────────────

describe("buildLongWeekendInfo", () => {
	const windows = [
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

	it("returns is_part_of true for dates in a window", () => {
		const info = buildLongWeekendInfo("2026-01-01", windows);
		assert.equal(info.is_part_of, true);
		assert.equal(info.window_start, "2026-01-01");
		assert.equal(info.window_end, "2026-01-04");
	});

	it("returns is_part_of false for dates not in any window", () => {
		const info = buildLongWeekendInfo("2026-06-15", windows);
		assert.equal(info.is_part_of, false);
		assert.equal(info.window_start, null);
		assert.equal(info.days, 0);
	});

	it("prefers natural (0 bridge) window when multiple match", () => {
		const overlapping = [
			{
				window_start: "2026-03-19",
				window_end: "2026-03-22",
				days: 4,
				holidays_included: ["Eid'l Fitr"],
				leave_days_needed: 1,
				dates: ["2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22"],
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
		const info = buildLongWeekendInfo("2026-03-20", overlapping);
		assert.equal(info.leave_days_needed, 0);
		assert.equal(info.days, 3);
	});
});
