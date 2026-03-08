# Changelog

All notable changes to the PH Holidays MCP Server are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-03-08

### Added

- **Tool: get_holidays.** Get all Philippine national holidays for a given year. Supports filtering by type (regular, special_non_working, special_working, islamic). Defaults to current year.

- **Tool: get_holiday_by_date.** Look up whether a specific date is a holiday. Returns the full holiday record with `is_holiday` and `is_working_day` flags. Non-holidays return `is_holiday: false, is_working_day: true`.

- **Tool: get_upcoming_holidays.** Get the next N upcoming holidays from a given date. Defaults to today in Asia/Manila timezone. Crosses into next year automatically if data is available in KV. Max 20 results.

- **Tool: is_working_day.** Boolean check for whether a date is a working day per proclamation data. Returns reason and holiday_type. Special working days (e.g. EDSA Anniversary) return `is_working_day: true`. Does not account for weekends.

- **Tool: get_long_weekends.** Returns all long weekend windows for a year. Includes natural long weekends (3+ consecutive non-working days) and bridge opportunities requiring 1-2 leave days. Computed dynamically from holiday data and weekend calendar.

- **Data pipeline scripts.** `seed.ts` for full KV load from proclamation source data, `validate.ts` for schema validation, `rollover.ts` for year promotion, `patch-eid.ts` for Eid date confirmation updates, `patch-holiday.ts` for ad hoc mid-year holiday additions.

- **2026 holiday data.** 21 holidays from Proclamation No. 1006 (signed September 3, 2025): 10 regular, 8 special non-working, 1 special working (EDSA), 2 Islamic (Eid'l Fitr and Eid'l Adha, pending NCMF confirmation).

- **Islamic holiday lifecycle.** Eid'l Fitr and Eid'l Adha seeded with estimated dates and `eid_confirmed: false`. Patchable via `npm run patch-eid` when NCMF confirms the actual date via separate proclamation.

- **`{ _meta, data }` response envelope.** Consistent with psgc-mcp. Metadata includes year, tier, proclamation reference, Eid confirmation statuses, and data source attribution.

- **Long weekend computation.** Clusters consecutive non-working days (holidays + weekends), identifies natural long weekends, and detects bridge opportunities with 1-2 day gaps between clusters. Each holiday record includes its `long_weekend` window info.
