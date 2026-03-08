/**
 * Year rollover script.
 * Promotes "next" year to "current" and drops the previous "current" year.
 *
 * Usage: npm run rollover
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

function wrangler(cmd: string): string {
	return execSync(`npx wrangler ${cmd}`, {
		cwd: PROJECT_ROOT,
		encoding: "utf-8",
	});
}

function main() {
	console.log("Year rollover: promoting next -> current\n");

	// Read current index
	const indexRaw = wrangler('kv key get --binding=HOLIDAYS_KV --local "holidays:index"');
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

	// Update meta for new current year
	const metaRaw = wrangler(`kv key get --binding=HOLIDAYS_KV --local "holidays:${newYear}:meta"`);
	const meta = JSON.parse(metaRaw);
	meta.tier = "current";
	meta.last_updated = new Date().toISOString().split("T")[0];

	wrangler(
		`kv key put --binding=HOLIDAYS_KV --local "holidays:${newYear}:meta" '${JSON.stringify(meta)}'`,
	);

	// Update index
	const newIndex = {
		years: [{ year: newYear, tier: "current" }],
		current_year: newYear,
		last_updated: new Date().toISOString().split("T")[0],
	};

	wrangler(
		`kv key put --binding=HOLIDAYS_KV --local "holidays:index" '${JSON.stringify(newIndex)}'`,
	);

	// Delete old year data (if exists)
	if (oldYear) {
		const keysToDelete = [
			`holidays:${oldYear}`,
			`holidays:${oldYear}:meta`,
		];

		// Get all holidays for the old year to delete per-date keys
		try {
			const oldHolidaysRaw = wrangler(
				`kv key get --binding=HOLIDAYS_KV --local "holidays:${oldYear}"`,
			);
			const oldHolidays = JSON.parse(oldHolidaysRaw);
			for (const h of oldHolidays) {
				keysToDelete.push(`holidays:${oldYear}:date:${h.date}`);
			}
		} catch {
			// Old year data might already be gone
		}

		for (const key of keysToDelete) {
			try {
				wrangler(`kv key delete --binding=HOLIDAYS_KV --local "${key}"`);
			} catch {
				// Key might not exist
			}
		}

		console.log(`Deleted ${keysToDelete.length} keys for ${oldYear}`);
	}

	console.log("\nRollover complete.");
}

main();
