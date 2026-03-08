/**
 * Patch Eid date after NCMF confirmation.
 *
 * Usage: npm run patch-eid -- --year=2026 --holiday=fitr --date=2026-03-21 --proclamation="No. 1234"
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
	const holidayArg = args.find((a) => a.startsWith("--holiday="));
	const dateArg = args.find((a) => a.startsWith("--date="));
	const proclamationArg = args.find((a) => a.startsWith("--proclamation="));

	if (!yearArg || !holidayArg || !dateArg || !proclamationArg) {
		console.error(
			'Usage: npm run patch-eid -- --year=2026 --holiday=fitr --date=2026-03-21 --proclamation="No. 1234"',
		);
		process.exit(1);
	}

	const year = parseInt(yearArg.split("=")[1], 10);
	const holiday = holidayArg.split("=")[1]; // "fitr" or "adha"
	const confirmedDate = dateArg.split("=")[1];
	const proclamation = proclamationArg.split("=")[1];

	const eidName = holiday === "fitr" ? "Eid'l Fitr" : "Eid'l Adha";
	const statusField = holiday === "fitr" ? "eid_fitr_status" : "eid_adha_status";

	console.log(`Patching ${eidName} for ${year}: confirmed date ${confirmedDate}\n`);

	// Load year array
	const holidaysRaw = wrangler(`kv key get --binding=HOLIDAYS_KV --local "holidays:${year}"`);
	const holidays = JSON.parse(holidaysRaw);

	// Find and update the Eid holiday
	const idx = holidays.findIndex(
		(h: { name: string; type: string }) => h.name === eidName && h.type === "islamic",
	);

	if (idx === -1) {
		console.error(`${eidName} not found in ${year} holidays.`);
		process.exit(1);
	}

	const oldDate = holidays[idx].date;
	const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const newDow = DAYS[new Date(confirmedDate + "T12:00:00Z").getUTCDay()];

	holidays[idx].date = confirmedDate;
	holidays[idx].day_of_week = newDow;
	holidays[idx].eid_confirmed = true;
	holidays[idx].confirmed_date = confirmedDate;
	holidays[idx].proclamation_ref = proclamation;
	holidays[idx].notes = null;

	// Re-sort by date
	holidays.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));

	// Update year array
	kvPut(`holidays:${year}`, JSON.stringify(holidays));

	// Remove old date key, add new
	if (oldDate !== confirmedDate) {
		try {
			wrangler(`kv key delete --binding=HOLIDAYS_KV --local "holidays:${year}:date:${oldDate}"`);
		} catch {
			// Key might not exist
		}
	}
	kvPut(`holidays:${year}:date:${confirmedDate}`, JSON.stringify(holidays[holidays.findIndex(
		(h: { name: string }) => h.name === eidName,
	)]));

	// Update meta
	const metaRaw = wrangler(`kv key get --binding=HOLIDAYS_KV --local "holidays:${year}:meta"`);
	const meta = JSON.parse(metaRaw);
	meta[statusField] = "confirmed";
	meta.last_updated = new Date().toISOString().split("T")[0];
	kvPut(`holidays:${year}:meta`, JSON.stringify(meta));

	console.log(`\n${eidName} patched: ${oldDate} -> ${confirmedDate} (${proclamation})`);
}

main();
