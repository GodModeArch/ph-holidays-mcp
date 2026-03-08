# PH Holidays MCP Server

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that provides Philippine national holiday data to LLMs. Built on Cloudflare Workers with KV storage.

Public, read-only, no authentication required. Data sourced from official presidential proclamations published in the [Official Gazette](https://www.officialgazette.gov.ph/nationwide-holidays/). Cached in Cloudflare KV for reliability and low-latency global access.

## Tools

| Tool | Description |
|------|-------------|
| `get_holidays` | Get all holidays for a given year, optionally filtered by type |
| `get_holiday_by_date` | Look up whether a specific date is a holiday |
| `get_upcoming_holidays` | Get the next N holidays from a given date |
| `is_working_day` | Check if a specific date is a working day per proclamation data |
| `get_long_weekends` | Get all long weekend windows for a year |

### Holiday Types

| Type | Value | Pay Behavior |
|------|-------|--------------|
| Regular Holiday | `regular` | 200% if worked, 260% on rest day |
| Special Non-Working | `special_non_working` | No work, no pay. 130% if worked |
| Special Working | `special_working` | Ordinary working day. No premium |
| Islamic Holiday | `islamic` | Same rules as regular. Separate proclamation. |

Pay rules are informational metadata only. This server does not compute pay.

## Response Format

All data responses are wrapped in a standard envelope:

```json
{
  "_meta": {
    "year": 2026,
    "tier": "current",
    "proclamation": "No. 1006",
    "eid_fitr_status": "pending",
    "eid_adha_status": "pending",
    "last_updated": "2026-03-08",
    "source": "Official Gazette of the Republic of the Philippines"
  },
  "data": { ... }
}
```

Error responses (`isError: true`) are returned as plain text without wrapping.

### Holiday Record

| Field | Type | Description |
|-------|------|-------------|
| `date` | `string` | ISO 8601 date: `YYYY-MM-DD` |
| `name` | `string` | Official holiday name |
| `type` | `string` | `regular`, `special_non_working`, `special_working`, `islamic` |
| `day_of_week` | `string` | Full day name (e.g. "Thursday") |
| `movable` | `boolean` | Whether the date is defined by a day-of-week rule |
| `double_holiday` | `boolean` | Whether two holidays share this date |
| `double_holiday_names` | `string[] \| null` | Names of both holidays when double |
| `long_weekend` | `object` | Long weekend window info (see below) |
| `source` | `object` | Proclamation reference |
| `notes` | `string \| null` | Additional context |

All fields are always present. Fields without data are `null`, never omitted.

### Islamic Holiday Record

Islamic holidays include additional fields:

| Field | Type | Description |
|-------|------|-------------|
| `eid_confirmed` | `boolean` | Whether the date has been confirmed by NCMF |
| `estimated_date` | `string` | Astronomical estimate before confirmation |
| `confirmed_date` | `string \| null` | Actual proclaimed date after confirmation |
| `proclamation_ref` | `string \| null` | Separate proclamation number |

### Long Weekend Window

| Field | Type | Description |
|-------|------|-------------|
| `is_part_of` | `boolean` | Whether this holiday is part of a long weekend |
| `window_start` | `string \| null` | First date of the window |
| `window_end` | `string \| null` | Last date of the window |
| `days` | `number` | Total days in the window |
| `leave_days_needed` | `number` | Bridge leave days required (0 = natural) |
| `dates` | `string[]` | All dates in the window |

### `is_working_day` Response

```json
{
  "_meta": { ... },
  "data": {
    "date": "2026-02-25",
    "is_working_day": true,
    "reason": "Special Working Day: EDSA People Power Revolution Anniversary",
    "holiday_type": "special_working"
  }
}
```

## Connect

Add to your MCP client configuration:
```json
{
  "mcpServers": {
    "ph-holidays": {
      "url": "https://ph-holidays.godmode.ph/mcp"
    }
  }
}
```

### Quick test
```bash
curl -X POST https://ph-holidays.godmode.ph/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_upcoming_holidays",
      "arguments": { "limit": 3 }
    }
  }'
```

## Quirks

1. **Islamic holidays have a 2-phase lifecycle.** Eid'l Fitr and Eid'l Adha appear in the main proclamation as "to be proclaimed." Dates are confirmed later via separate proclamations after NCMF recommendation. The `eid_fitr_status` and `eid_adha_status` fields in `_meta` signal `"pending"` or `"confirmed"`. When pending, `estimated_date` is included but is not authoritative.

2. **Special working days are counterintuitive.** The EDSA People Power Anniversary (Feb 25, 2026) appears in the proclamation but is a *working* day with no premium. `is_working_day` returns `true`. `holiday_type` returns `"special_working"`. Example:
   ```
   is_working_day("2026-02-25") -> true, reason: "Special Working Day: EDSA..."
   ```

3. **`is_working_day` does not account for weekends.** Checks proclamation data only. Saturday/Sunday handling is the caller's responsibility. Rest day schedules vary by employer and are outside this server's scope.

4. **Double holidays are rare but flagged.** When 2 holidays fall on the same date, `double_holiday: true` is set on the record. Pay stacking rules apply but computation is not handled by this server.

5. **Pending Eid dates should not be used for hard scheduling.** When `eid_confirmed` is `false`, `estimated_date` is based on astronomical estimates. The actual proclaimed date may differ by 1 day.

6. **Local holidays are out of scope.** City-level holidays (Quezon City Day, Manila Day, Cebu City Charter Day, etc.) are not included. Reserved for v2 integration via psgc-mcp cross-reference.

7. **`next` year data may not be available.** The index only includes next year after the proclamation drops (typically October). `get_upcoming_holidays` crossing into the next year will stop at Dec 31 if next year is not yet loaded.

## Data Sources

| Source | Used For |
|--------|----------|
| [Official Gazette](https://www.officialgazette.gov.ph/nationwide-holidays/) | Authoritative proclamation text |
| Presidential Proclamations (Malacanan) | Annual holiday list |
| DOLE Labor Advisories | Pay rule reference (informational) |
| NCMF | Eid date confirmations |

Current year: 2026 (Proclamation No. 1006, signed September 3, 2025).

## Year Coverage

| Tier | Years | Notes |
|------|-------|-------|
| `current` | 2026 | Actively maintained. Eid patched when confirmed. |
| `next` | -- | Loaded in October when proclamation drops. |

At any given time, KV holds at most 2 years. No historical data.

## Data Pipeline

```
scripts/
  data/
    2026/  proclamation-source.json
  seed.ts          -- full KV load for a given year
  rollover.ts      -- promote next to current, drop old current
  patch-eid.ts     -- targeted Eid date update
  patch-holiday.ts -- ad hoc single holiday patch
  validate.ts      -- schema validation before deploy
```

### Seed a year
```bash
npm run seed -- --year=2026
```

### Validate before deploy
```bash
npm run validate -- --year=2026
```

### Patch Eid after NCMF confirmation
```bash
npm run patch-eid -- --year=2026 --holiday=fitr --date=2026-03-21 --proclamation="No. 1234"
```

### Year rollover (January 1)
```bash
npm run rollover
```

## Development

```bash
npm install
npm run seed -- --year=2026
npm run dev
```

Dev server starts at `http://localhost:8787`. Connect your MCP client to `http://localhost:8787/mcp`.

### Setup

Before first deploy, create the KV namespace:
```bash
npx wrangler kv namespace create HOLIDAYS_KV
```

Update `wrangler.jsonc` with the returned namespace ID.

## Related Projects

Part of a suite of Philippine public data MCP servers:

- **[PSGC MCP](https://github.com/GodModeArch/psgc-mcp)** - Philippine Standard Geographic Code
- **[LTS MCP](https://github.com/GodModeArch/lts-mcp)** - DHSUD License to Sell verification
- **PH Holidays MCP** (this repo)
- **BSP Bank Directory MCP** -> Coming soon

All servers are free, public, and read-only. Data pulled from official Philippine government sources.

## Contributing and Issues

Found a data error or a holiday that was missed? Open an issue. Philippine holidays can change via mid-year proclamations, and the issues list is the best place to flag them.

Eid dates are confirmed separately each year. When NCMF announces the confirmed date, open an issue or PR with the proclamation reference.

## Built by

**Aaron Zara** - Fractional CTO at [Godmode Digital](https://godmode.ph)

For enterprise SLAs, custom integrations, or other PH data sources:
-> [godmode.ph](https://godmode.ph)

## License

MIT
