/**
 * Year rollover script.
 * Promotes "next" year to "current" and drops the previous "current" year.
 *
 * Usage: npm run rollover
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { kvGet, kvPutBatch, kvDelete } from "./lib/kv-helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

function main() {
	console.log("Year rollover: promoting next -> current\n");

	// Read current index
	const indexRaw = kvGet("holidays:index", PROJECT_ROOT);
	const index = JSON.parse(indexRaw);

	const currentEntry = index.years.find((y: { tier: string }) => y.tier === "current");
	const nextEntry = index.years.find((y: { tier: string }) => y.tier === "next");

	if (!nextEntry) {
		console.error("No 'next' year found in index. Nothing to promote.");
		process.exit(1);
	}

	const oldYear = currentEntry?.year;
	const newYear = nextEntry.year;

	console.log(`Promoting ${newYear} from next -> current`);
	if (oldYear) {
		console.log(`Dropping ${oldYear} (previous current)`);
	}

	// Update meta for new current year and index
	const metaRaw = kvGet(`holidays:${newYear}:meta`, PROJECT_ROOT);
	const meta = JSON.parse(metaRaw);
	meta.tier = "current";
	meta.last_updated = new Date().toISOString().split("T")[0];

	const newIndex = {
		years: [{ year: newYear, tier: "current" }],
		current_year: newYear,
		last_updated: new Date().toISOString().split("T")[0],
	};

	kvPutBatch([
		{ key: `holidays:${newYear}:meta`, value: JSON.stringify(meta) },
		{ key: "holidays:index", value: JSON.stringify(newIndex) },
	], PROJECT_ROOT);

	// Delete old year data (if exists)
	if (oldYear) {
		const keysToDelete = [
			`holidays:${oldYear}`,
			`holidays:${oldYear}:meta`,
			`holidays:${oldYear}:long_weekends`,
		];

		// Get all holidays for the old year to delete per-date keys
		try {
			const oldHolidaysRaw = kvGet(`holidays:${oldYear}`, PROJECT_ROOT);
			const oldHolidays = JSON.parse(oldHolidaysRaw);
			for (const h of oldHolidays) {
				keysToDelete.push(`holidays:${oldYear}:date:${h.date}`);
			}
		} catch {
			// Old year data might already be gone
		}

		for (const key of keysToDelete) {
			kvDelete(key, PROJECT_ROOT);
		}

		console.log(`Deleted ${keysToDelete.length} keys for ${oldYear}`);
	}

	console.log("\nRollover complete.");
}

main();
