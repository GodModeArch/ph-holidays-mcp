import type { YearMeta } from "./types";

export interface ApiMeta {
	year: number;
	tier: string;
	proclamation: string;
	eid_fitr_status: string;
	eid_adha_status: string;
	last_updated: string;
	source: string;
}

export function buildMeta(yearMeta: YearMeta): ApiMeta {
	return {
		year: yearMeta.year,
		tier: yearMeta.tier,
		proclamation: yearMeta.proclamation,
		eid_fitr_status: yearMeta.eid_fitr_status,
		eid_adha_status: yearMeta.eid_adha_status,
		last_updated: yearMeta.last_updated,
		source: yearMeta.source,
	};
}

export function wrapResponse<T>(data: T, meta: ApiMeta): { _meta: ApiMeta; data: T } {
	return { _meta: meta, data };
}
