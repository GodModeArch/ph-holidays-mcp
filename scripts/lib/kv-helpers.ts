/**
 * Safe KV helpers for scripts.
 * Uses bulk put via temp file to avoid shell injection from
 * interpolating values into shell command strings.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export function kvGet(key: string, projectRoot: string): string {
	return execSync(`npx wrangler kv key get --binding=HOLIDAYS_KV --local "${key}"`, {
		cwd: projectRoot,
		encoding: "utf-8",
	});
}

export function kvPut(key: string, value: string, projectRoot: string): void {
	kvPutBatch([{ key, value }], projectRoot);
}

export function kvPutBatch(entries: { key: string; value: string }[], projectRoot: string): void {
	const tmpFile = path.join(projectRoot, ".tmp-kv-bulk.json");
	fs.writeFileSync(tmpFile, JSON.stringify(entries));
	try {
		execSync(`npx wrangler kv bulk put "${tmpFile}" --binding=HOLIDAYS_KV --local`, {
			cwd: projectRoot,
			stdio: "inherit",
		});
	} finally {
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			// Cleanup best-effort
		}
	}
}

export function kvDelete(key: string, projectRoot: string): void {
	try {
		execSync(`npx wrangler kv key delete --binding=HOLIDAYS_KV --local "${key}"`, {
			cwd: projectRoot,
			encoding: "utf-8",
		});
	} catch {
		// Key might not exist
	}
}
