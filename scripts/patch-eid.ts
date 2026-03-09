/**
 * Patch Eid date after NCMF confirmation.
 *
 * Usage: npm run patch-eid -- --year=2026 --holiday=fitr --date=2026-03-21 --proclamation="No. 1234"
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { kvGet, kvPutBatch, kvDelete } from "./lib/kv-helpers";
import {
	computeLongWeekends,
	buildLongWeekendInfo,
	getDayOfWeek,
} from "./lib/long-weekends";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

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
	const holidaysRaw = kvGet(`holidays:${year}`, PROJECT_ROOT);
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
	holidays[idx].date = confirmedDate;
	holidays[idx].day_of_week = getDayOfWeek(confirmedDate);
	holidays[idx].eid_confirmed = true;
	holidays[idx].confirmed_date = confirmedDate;
	holidays[idx].proclamation_ref = proclamation;
	holidays[idx].notes = null;

	// Re-sort by date
	holidays.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));

	// Recompute long weekends for all holidays
	const longWeekendWindows = computeLongWeekends(holidays, year);
	console.log(`Recomputed ${longWeekendWindows.length} long weekend windows.`);

	for (const h of holidays) {
		h.long_weekend = buildLongWeekendInfo(h.date, longWeekendWindows);
	}

	// Build per-date entries (grouped for double holidays)
	const byDate = new Map<string, (typeof holidays[0])[]>();
	for (const h of holidays) {
		const existing = byDate.get(h.date) || [];
		existing.push(h);
		byDate.set(h.date, existing);
	}

	const kvEntries: { key: string; value: string }[] = [];

	// Year array
	kvEntries.push({ key: `holidays:${year}`, value: JSON.stringify(holidays) });

	// Per-date entries
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

	// Update meta
	const metaRaw = kvGet(`holidays:${year}:meta`, PROJECT_ROOT);
	const meta = JSON.parse(metaRaw);
	meta[statusField] = "confirmed";
	meta.last_updated = new Date().toISOString().split("T")[0];
	kvEntries.push({ key: `holidays:${year}:meta`, value: JSON.stringify(meta) });

	// Remove old date key if date changed
	if (oldDate !== confirmedDate) {
		kvDelete(`holidays:${year}:date:${oldDate}`, PROJECT_ROOT);
	}

	// Batch write all updates
	kvPutBatch(kvEntries, PROJECT_ROOT);

	console.log(`\n${eidName} patched: ${oldDate} -> ${confirmedDate} (${proclamation})`);
}

main();
