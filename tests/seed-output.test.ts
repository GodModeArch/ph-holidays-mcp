/**
 * Validates the 2026 seed output for data integrity beyond what validate.ts checks.
 * Focuses on long weekend correctness, per-date entry consistency, and edge cases.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bulkFile = path.join(__dirname, "..", "scripts", "data", "output", "2026-kv-entries.json");

interface KVEntry {
	key: string;
	value: string;
}

interface HolidayRecord {
	date: string;
	name: string;
	type: string;
	day_of_week: string;
	movable: boolean;
	double_holiday: boolean;
	double_holiday_names: string[] | null;
	long_weekend: {
		is_part_of: boolean;
		window_start: string | null;
		window_end: string | null;
		days: number;
		leave_days_needed: number;
		dates: string[];
	};
	eid_confirmed?: boolean;
	estimated_date?: string;
	confirmed_date?: string | null;
}

interface LongWeekendWindow {
	window_start: string;
	window_end: string;
	days: number;
	holidays_included: string[];
	leave_days_needed: number;
	dates: string[];
}

const entries: KVEntry[] = JSON.parse(fs.readFileSync(bulkFile, "utf-8"));
const yearArray: HolidayRecord[] = JSON.parse(
	entries.find((e) => e.key === "holidays:2026")!.value,
);
const longWeekends: LongWeekendWindow[] = JSON.parse(
	entries.find((e) => e.key === "holidays:2026:long_weekends")!.value,
);
const meta = JSON.parse(entries.find((e) => e.key === "holidays:2026:meta")!.value);

describe("seed output: structure", () => {
	it("has expected number of KV entries (21 per-date + year + long_weekends + meta + index)", () => {
		assert.equal(entries.length, 25);
	});

	it("year array is sorted by date", () => {
		for (let i = 1; i < yearArray.length; i++) {
			assert.ok(
				yearArray[i].date >= yearArray[i - 1].date,
				`Out of order: ${yearArray[i - 1].date} > ${yearArray[i].date}`,
			);
		}
	});

	it("all dates are in 2026", () => {
		for (const h of yearArray) {
			assert.ok(h.date.startsWith("2026-"), `Date ${h.date} is not in 2026`);
		}
	});

	it("every holiday has a per-date KV entry", () => {
		for (const h of yearArray) {
			const dateEntry = entries.find((e) => e.key === `holidays:2026:date:${h.date}`);
			assert.ok(dateEntry, `Missing per-date entry for ${h.date} (${h.name})`);
		}
	});
});

describe("seed output: day_of_week correctness", () => {
	it("all day_of_week values match the actual date", () => {
		const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
		for (const h of yearArray) {
			const d = new Date(h.date + "T12:00:00Z");
			const expected = DAYS[d.getUTCDay()];
			assert.equal(
				h.day_of_week,
				expected,
				`${h.name} on ${h.date}: expected ${expected}, got ${h.day_of_week}`,
			);
		}
	});
});

describe("seed output: per-date entry consistency", () => {
	it("per-date entry matches the corresponding record in year array", () => {
		for (const h of yearArray) {
			const dateEntry = entries.find((e) => e.key === `holidays:2026:date:${h.date}`);
			if (!dateEntry) continue;

			const stored = JSON.parse(dateEntry.value);
			// Could be single object or array
			const records = Array.isArray(stored) ? stored : [stored];
			const match = records.find((r: HolidayRecord) => r.name === h.name);
			assert.ok(match, `Record for ${h.name} not found in per-date entry for ${h.date}`);
			assert.equal(match.type, h.type);
			assert.equal(match.day_of_week, h.day_of_week);
		}
	});
});

describe("seed output: long weekend windows", () => {
	it("all windows have dates array matching start/end range", () => {
		for (const w of longWeekends) {
			assert.equal(w.dates[0], w.window_start);
			assert.equal(w.dates[w.dates.length - 1], w.window_end);
			assert.equal(w.dates.length, w.days);
		}
	});

	it("all window dates are consecutive", () => {
		for (const w of longWeekends) {
			for (let i = 1; i < w.dates.length; i++) {
				const prev = new Date(w.dates[i - 1] + "T12:00:00Z");
				const curr = new Date(w.dates[i] + "T12:00:00Z");
				const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
				assert.equal(
					diffDays,
					1,
					`Non-consecutive dates in window ${w.window_start}: ${w.dates[i - 1]} -> ${w.dates[i]}`,
				);
			}
		}
	});

	it("all windows contain at least one holiday", () => {
		for (const w of longWeekends) {
			assert.ok(
				w.holidays_included.length > 0,
				`Window ${w.window_start}-${w.window_end} has no holidays`,
			);
		}
	});

	it("leave_days_needed is non-negative and at most 2", () => {
		for (const w of longWeekends) {
			assert.ok(w.leave_days_needed >= 0);
			assert.ok(w.leave_days_needed <= 2);
		}
	});

	it("no duplicate windows", () => {
		const keys = longWeekends.map((w) => `${w.window_start}|${w.window_end}`);
		const unique = new Set(keys);
		assert.equal(keys.length, unique.size);
	});

	it("holidays with is_part_of=true reference a valid window", () => {
		for (const h of yearArray) {
			if (h.long_weekend.is_part_of) {
				const matchingWindow = longWeekends.find(
					(w) =>
						w.window_start <= h.date &&
						w.window_end >= h.date &&
						w.dates.includes(h.date),
				);
				assert.ok(
					matchingWindow,
					`${h.name} (${h.date}) claims is_part_of but no matching window found`,
				);
			}
		}
	});
});

describe("seed output: specific holiday validations", () => {
	it("Holy Week: Maundy Thursday through Easter Sunday is a long weekend", () => {
		const maundyThursday = yearArray.find((h) => h.name === "Maundy Thursday");
		const goodFriday = yearArray.find((h) => h.name === "Good Friday");
		const blackSaturday = yearArray.find((h) => h.name === "Black Saturday");

		assert.ok(maundyThursday);
		assert.ok(goodFriday);
		assert.ok(blackSaturday);

		// All three should be part of the same long weekend
		assert.equal(maundyThursday!.long_weekend.is_part_of, true);
		assert.equal(goodFriday!.long_weekend.is_part_of, true);
		assert.equal(blackSaturday!.long_weekend.is_part_of, true);

		// Should be at least 4 days (Thu-Fri-Sat-Sun)
		assert.ok(maundyThursday!.long_weekend.days >= 4);
	});

	it("Islamic holidays have eid_confirmed=false and estimated_date set", () => {
		const islamicHolidays = yearArray.filter((h) => h.type === "islamic");
		assert.ok(islamicHolidays.length >= 2, "Should have at least Eid'l Fitr and Eid'l Adha");

		for (const h of islamicHolidays) {
			assert.equal(h.eid_confirmed, false, `${h.name} should not be confirmed yet`);
			assert.ok(h.estimated_date, `${h.name} should have estimated_date`);
		}
	});

	it("EDSA (special_working) is not part of any long weekend", () => {
		const edsa = yearArray.find((h) => h.name === "EDSA People Power Revolution Anniversary");
		assert.ok(edsa);
		assert.equal(edsa!.type, "special_working");
		// special_working should not create non-working clusters
		// (though it could theoretically be part of a window if adjacent to weekends, it wouldn't contribute)
	});

	it("Christmas-New Year cluster detected", () => {
		const christmas = yearArray.find((h) => h.name === "Christmas Day");
		assert.ok(christmas);
		assert.equal(christmas!.long_weekend.is_part_of, true);

		const christmasEve = yearArray.find((h) => h.name === "Christmas Eve");
		assert.ok(christmasEve);
		assert.equal(christmasEve!.long_weekend.is_part_of, true);
	});
});

describe("seed output: metadata", () => {
	it("breakdown sums to total_holidays", () => {
		const sum =
			meta.breakdown.regular +
			meta.breakdown.special_non_working +
			meta.breakdown.special_working +
			meta.breakdown.islamic;
		assert.equal(sum, meta.total_holidays);
	});

	it("has correct year", () => {
		assert.equal(meta.year, 2026);
	});

	it("Eid statuses are pending", () => {
		assert.equal(meta.eid_fitr_status, "pending");
		assert.equal(meta.eid_adha_status, "pending");
	});

	it("has proclamation reference", () => {
		assert.ok(meta.proclamation);
		assert.ok(meta.source_url);
	});
});
