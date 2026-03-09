/**
 * Schema validation for holiday data before deploy.
 *
 * Usage: npm run validate -- --year=2026
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_TYPES = ["regular", "special_non_working", "special_working", "islamic"];
const VALID_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function main() {
	const args = process.argv.slice(2);
	const yearArg = args.find((a) => a.startsWith("--year="));
	if (!yearArg) {
		console.error("Usage: npm run validate -- --year=YYYY");
		process.exit(1);
	}

	const year = parseInt(yearArg.split("=")[1], 10);
	const bulkFile = path.join(__dirname, "data", "output", `${year}-kv-entries.json`);

	if (!fs.existsSync(bulkFile)) {
		console.error(`Bulk file not found: ${bulkFile}`);
		console.error("Run 'npm run seed -- --year=YYYY' first.");
		process.exit(1);
	}

	const entries: { key: string; value: string }[] = JSON.parse(
		fs.readFileSync(bulkFile, "utf-8"),
	);

	let errors = 0;

	// Find the year array entry
	const yearEntry = entries.find((e) => e.key === `holidays:${year}`);
	if (!yearEntry) {
		console.error(`Missing holidays:${year} key`);
		process.exit(1);
	}

	const holidays = JSON.parse(yearEntry.value);
	console.log(`Validating ${holidays.length} holidays for ${year}...\n`);

	for (const h of holidays) {
		// Required fields
		if (!h.date || typeof h.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) {
			console.error(`Invalid date: ${h.date}`);
			errors++;
		}

		if (!h.name || typeof h.name !== "string") {
			console.error(`Missing name for ${h.date}`);
			errors++;
		}

		if (!VALID_TYPES.includes(h.type)) {
			console.error(`Invalid type "${h.type}" for ${h.name}`);
			errors++;
		}

		if (!VALID_DAYS.includes(h.day_of_week)) {
			console.error(`Invalid day_of_week "${h.day_of_week}" for ${h.name}`);
			errors++;
		}

		if (typeof h.movable !== "boolean") {
			console.error(`Invalid movable field for ${h.name}`);
			errors++;
		}

		if (typeof h.double_holiday !== "boolean") {
			console.error(`Invalid double_holiday field for ${h.name}`);
			errors++;
		}

		if (!h.long_weekend || typeof h.long_weekend.is_part_of !== "boolean") {
			console.error(`Invalid long_weekend field for ${h.name}`);
			errors++;
		}

		if (!h.source || !h.source.proclamation) {
			console.error(`Missing source for ${h.name}`);
			errors++;
		}

		// Islamic-specific
		if (h.type === "islamic") {
			if (typeof h.eid_confirmed !== "boolean") {
				console.error(`Missing eid_confirmed for ${h.name}`);
				errors++;
			}
			if (!h.estimated_date) {
				console.error(`Missing estimated_date for ${h.name}`);
				errors++;
			}
		}

		// Verify year matches
		if (!h.date.startsWith(String(year))) {
			console.error(`Date ${h.date} does not match year ${year}`);
			errors++;
		}

		console.log(`  ${h.date} ${h.name} (${h.type}) - ${h.day_of_week}`);
	}

	// Verify per-date entries exist
	for (const h of holidays) {
		const dateEntry = entries.find((e) => e.key === `holidays:${year}:date:${h.date}`);
		if (!dateEntry) {
			console.error(`Missing per-date KV entry for ${h.date}`);
			errors++;
		}
	}

	// Verify meta exists
	const metaEntry = entries.find((e) => e.key === `holidays:${year}:meta`);
	if (!metaEntry) {
		console.error("Missing meta KV entry");
		errors++;
	} else {
		const meta = JSON.parse(metaEntry.value);
		const sum =
			meta.breakdown.regular +
			meta.breakdown.special_non_working +
			meta.breakdown.special_working +
			meta.breakdown.islamic;

		if (sum !== meta.total_holidays) {
			console.error(`Breakdown sum (${sum}) does not match total_holidays (${meta.total_holidays})`);
			errors++;
		}
	}

	// Verify long_weekends exists
	const longWeekendsEntry = entries.find((e) => e.key === `holidays:${year}:long_weekends`);
	if (!longWeekendsEntry) {
		console.error("Missing long_weekends KV entry");
		errors++;
	} else {
		const windows = JSON.parse(longWeekendsEntry.value);
		if (!Array.isArray(windows)) {
			console.error("long_weekends entry is not an array");
			errors++;
		} else {
			console.log(`\n  ${windows.length} long weekend windows`);
		}
	}

	// Verify index exists
	const indexEntry = entries.find((e) => e.key === "holidays:index");
	if (!indexEntry) {
		console.error("Missing index KV entry");
		errors++;
	}

	console.log(`\n${errors === 0 ? "PASS" : "FAIL"}: ${errors} error(s) found.`);
	if (errors > 0) process.exit(1);
}

main();
