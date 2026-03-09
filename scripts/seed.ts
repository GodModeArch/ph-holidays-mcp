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
import {
	computeLongWeekends,
	buildLongWeekendInfo,
	getDayOfWeek,
} from "./lib/long-weekends";

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

	// Per-date lookups (grouped for double holidays)
	const byDate = new Map<string, Record<string, unknown>[]>();
	for (const record of records) {
		const date = record.date as string;
		const existing = byDate.get(date) || [];
		existing.push(record);
		byDate.set(date, existing);
	}

	for (const [date, dateRecords] of byDate) {
		kvEntries.push({
			key: `holidays:${year}:date:${date}`,
			value: JSON.stringify(dateRecords.length === 1 ? dateRecords[0] : dateRecords),
		});
	}

	// Long weekend windows
	kvEntries.push({
		key: `holidays:${year}:long_weekends`,
		value: JSON.stringify(longWeekendWindows),
	});

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
