/**
 * Ad hoc holiday patch (mid-year special days).
 *
 * Usage: npm run patch-holiday -- --year=2026 --date=2026-06-18 --type=special_non_working --name="National Whatever Day"
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

function kvPut(key: string, value: string): void {
	execSync(`npx wrangler kv key put --binding=HOLIDAYS_KV --local "${key}" '${value}'`, {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
	});
}

function main() {
	const args = process.argv.slice(2);
	const yearArg = args.find((a) => a.startsWith("--year="));
	const dateArg = args.find((a) => a.startsWith("--date="));
	const typeArg = args.find((a) => a.startsWith("--type="));
	const nameArg = args.find((a) => a.startsWith("--name="));

	if (!yearArg || !dateArg || !typeArg || !nameArg) {
		console.error(
			'Usage: npm run patch-holiday -- --year=2026 --date=2026-06-18 --type=special_non_working --name="Name"',
		);
		process.exit(1);
	}

	const year = parseInt(yearArg.split("=")[1], 10);
	const date = dateArg.split("=")[1];
	const type = typeArg.split("=")[1];
	const name = nameArg.split("=")[1];

	const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const dayOfWeek = DAYS[new Date(date + "T12:00:00Z").getUTCDay()];

	console.log(`Patching: adding ${name} on ${date} (${type})\n`);

	// Load year array
	const holidaysRaw = wrangler(`kv key get --binding=HOLIDAYS_KV --local "holidays:${year}"`);
	const holidays = JSON.parse(holidaysRaw);

	// Build new record
	const newRecord = {
		date,
		name,
		type,
		day_of_week: dayOfWeek,
		movable: false,
		double_holiday: false,
		double_holiday_names: null,
		long_weekend: {
			is_part_of: false,
			window_start: null,
			window_end: null,
			days: 0,
			leave_days_needed: 0,
			dates: [],
		},
		source: {
			proclamation: "Ad hoc proclamation",
			signed_date: new Date().toISOString().split("T")[0],
			authority: "Office of the President",
		},
		notes: null,
	};

	holidays.push(newRecord);
	holidays.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));

	// Update KV
	kvPut(`holidays:${year}`, JSON.stringify(holidays));
	kvPut(`holidays:${year}:date:${date}`, JSON.stringify(newRecord));

	// Update meta
	const metaRaw = wrangler(`kv key get --binding=HOLIDAYS_KV --local "holidays:${year}"`);
	const meta = JSON.parse(metaRaw);
	// Re-read actual meta
	const actualMetaRaw = wrangler(`kv key get --binding=HOLIDAYS_KV --local "holidays:${year}:meta"`);
	const actualMeta = JSON.parse(actualMetaRaw);
	actualMeta.total_holidays = holidays.length;
	actualMeta.last_updated = new Date().toISOString().split("T")[0];

	// Recount breakdown
	actualMeta.breakdown = {
		regular: holidays.filter((h: { type: string }) => h.type === "regular").length,
		special_non_working: holidays.filter((h: { type: string }) => h.type === "special_non_working").length,
		special_working: holidays.filter((h: { type: string }) => h.type === "special_working").length,
		islamic: holidays.filter((h: { type: string }) => h.type === "islamic").length,
	};

	kvPut(`holidays:${year}:meta`, JSON.stringify(actualMeta));

	console.log(`Added ${name} on ${date} (${dayOfWeek}).`);
}

main();
