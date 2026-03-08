/**
 * PH Holidays KV Seeder
 *
 * Reads proclamation-source.json for a given year, transforms into
 * full holiday records, and writes to local Cloudflare KV via wrangler.
 *
 * Usage: npm run seed -- --year=2026
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface SourceHoliday {
	date: string;
	name: string;
	type: "regular" | "special_non_working" | "special_working" | "islamic";
	movable: boolean;
	eid_confirmed?: boolean;
	estimated_date?: string;
	notes?: string;
}

interface ProclamationSource {
	year: number;
	proclamation: string;
	signed_by: string;
	signed_date: string;
	published_date: string;
	source: string;
	source_url: string;
	dole_advisory: string;
	holidays: SourceHoliday[];
}

interface LongWeekendInfo {
	is_part_of: boolean;
	window_start: string | null;
	window_end: string | null;
	days: number;
	leave_days_needed: number;
	dates: string[];
}

interface LongWeekendWindow {
	window_start: string;
	window_end: string;
	days: number;
	holidays_included: string[];
	leave_days_needed: number;
	dates: string[];
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatDate(d: Date): string {
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function getDayOfWeek(dateStr: string): string {
	const d = new Date(dateStr + "T12:00:00Z");
	return DAYS_OF_WEEK[d.getUTCDay()];
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

function computeLongWeekends(
	holidays: SourceHoliday[],
	year: number,
): LongWeekendWindow[] {
	const nonWorking = new Set<string>();
	const holidayMap = new Map<string, SourceHoliday[]>();

	// Add all weekends
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

function buildLongWeekendInfo(
	holidayDate: string,
	windows: LongWeekendWindow[],
): LongWeekendInfo {
	// Find the best (smallest) window this holiday belongs to
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

function main() {
	const args = process.argv.slice(2);
	const yearArg = args.find((a) => a.startsWith("--year="));
	if (!yearArg) {
		console.error("Usage: npm run seed -- --year=YYYY");
		process.exit(1);
	}

	const year = parseInt(yearArg.split("=")[1], 10);
	const sourceFile = path.join(__dirname, "data", String(year), "proclamation-source.json");

	if (!fs.existsSync(sourceFile)) {
		console.error(`Source file not found: ${sourceFile}`);
		process.exit(1);
	}

	const source: ProclamationSource = JSON.parse(fs.readFileSync(sourceFile, "utf-8"));
	console.log(`Seeding ${year} holidays from ${source.proclamation}...\n`);

	// Compute long weekend windows
	const longWeekendWindows = computeLongWeekends(source.holidays, year);
	console.log(`Computed ${longWeekendWindows.length} long weekend windows.`);

	// Build full holiday records
	const records: Record<string, unknown>[] = [];
	const sortedHolidays = [...source.holidays].sort((a, b) => a.date.localeCompare(b.date));

	// Detect double holidays
	const dateCount = new Map<string, SourceHoliday[]>();
	for (const h of sortedHolidays) {
		const existing = dateCount.get(h.date) || [];
		existing.push(h);
		dateCount.set(h.date, existing);
	}

	for (const h of sortedHolidays) {
		const sameDate = dateCount.get(h.date) || [];
		const isDouble = sameDate.length > 1;

		const baseRecord = {
			date: h.date,
			name: h.name,
			type: h.type,
			day_of_week: getDayOfWeek(h.date),
			movable: h.movable,
			double_holiday: isDouble,
			double_holiday_names: isDouble ? sameDate.map((s) => s.name) : null,
			long_weekend: buildLongWeekendInfo(h.date, longWeekendWindows),
			source: {
				proclamation: source.proclamation,
				signed_date: source.signed_date,
				authority: "Office of the President",
			},
			notes: h.notes || null,
		};

		if (h.type === "islamic") {
			Object.assign(baseRecord, {
				eid_confirmed: h.eid_confirmed ?? false,
				estimated_date: h.estimated_date ?? h.date,
				confirmed_date: null,
				proclamation_ref: null,
			});
		}

		records.push(baseRecord);
	}

	// Build KV entries
	const kvEntries: { key: string; value: string }[] = [];

	// Full year array
	kvEntries.push({
		key: `holidays:${year}`,
		value: JSON.stringify(records),
	});

	// Per-date lookups
	for (const record of records) {
		kvEntries.push({
			key: `holidays:${year}:date:${record.date}`,
			value: JSON.stringify(record),
		});
	}

	// Year metadata
	const breakdown = {
		regular: sortedHolidays.filter((h) => h.type === "regular").length,
		special_non_working: sortedHolidays.filter((h) => h.type === "special_non_working").length,
		special_working: sortedHolidays.filter((h) => h.type === "special_working").length,
		islamic: sortedHolidays.filter((h) => h.type === "islamic").length,
	};

	const meta = {
		year,
		tier: "current",
		proclamation: source.proclamation,
		signed_by: source.signed_by,
		signed_date: source.signed_date,
		published_date: source.published_date,
		source: source.source,
		source_url: source.source_url,
		dole_advisory: source.dole_advisory,
		eid_fitr_status: "pending",
		eid_adha_status: "pending",
		last_updated: new Date().toISOString().split("T")[0],
		total_holidays: sortedHolidays.length,
		breakdown,
	};

	kvEntries.push({
		key: `holidays:${year}:meta`,
		value: JSON.stringify(meta),
	});

	// Index
	const index = {
		years: [{ year, tier: "current" as const }],
		current_year: year,
		last_updated: new Date().toISOString().split("T")[0],
	};

	kvEntries.push({
		key: "holidays:index",
		value: JSON.stringify(index),
	});

	// Write bulk file and upload
	const outputDir = path.join(__dirname, "data", "output");
	fs.mkdirSync(outputDir, { recursive: true });

	const bulkFile = path.join(outputDir, `${year}-kv-entries.json`);
	fs.writeFileSync(bulkFile, JSON.stringify(kvEntries, null, 2));
	console.log(`\nWrote ${kvEntries.length} KV entries to ${bulkFile}`);

	// Upload to local KV
	console.log("\nUploading to local KV...");
	try {
		execSync(`npx wrangler kv bulk put "${bulkFile}" --binding=HOLIDAYS_KV --local`, {
			stdio: "inherit",
			cwd: path.join(__dirname, ".."),
		});
		console.log("\nLocal KV seeded successfully.");
	} catch {
		console.error("\nFailed to upload to local KV.");
		console.error("Make sure wrangler is installed: npm install");
		process.exit(1);
	}
}

main();
