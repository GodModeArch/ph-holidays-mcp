import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import {
	handleGetHolidays,
	handleGetHolidayByDate,
	handleGetUpcomingHolidays,
	handleIsWorkingDay,
	handleGetLongWeekends,
} from "./tool-handlers";

const HOLIDAY_TYPES = ["regular", "special_non_working", "special_working", "islamic"] as const;

export class HolidaysMCP extends McpAgent {
	server = new McpServer({
		name: "PH Holidays",
		version: "1.0.0",
	});

	async init() {
		const kv = this.env.HOLIDAYS_KV;

		// ── Tool 1: get_holidays ──────────────────────────────────────

		this.server.tool(
			"get_holidays",
			"Get all Philippine national holidays for a given year. Optionally filter by type (regular, special_non_working, special_working, islamic). Data sourced from official presidential proclamations.",
			{
				year: z
					.number()
					.int()
					.optional()
					.describe("Year to query (defaults to current year). Only current and next year available."),
				type: z
					.enum(HOLIDAY_TYPES)
					.optional()
					.describe(
						"Filter by holiday type: regular, special_non_working, special_working, islamic",
					),
			},
			async ({ year, type }) => handleGetHolidays({ year, type }, kv),
		);

		// ── Tool 2: get_holiday_by_date ───────────────────────────────

		this.server.tool(
			"get_holiday_by_date",
			"Look up whether a specific date is a Philippine holiday. Returns the holiday record if found, or indicates it is a regular working day.",
			{
				date: z
					.string()
					.describe("Date to check in ISO 8601 format: YYYY-MM-DD"),
			},
			async ({ date }) => handleGetHolidayByDate({ date }, kv),
		);

		// ── Tool 3: get_upcoming_holidays ─────────────────────────────

		this.server.tool(
			"get_upcoming_holidays",
			"Get the next N upcoming Philippine holidays from a given date. Defaults to today (Philippine time). Crosses into next year if data is available.",
			{
				from_date: z
					.string()
					.optional()
					.describe("Start date in YYYY-MM-DD format (defaults to today in Asia/Manila timezone)"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("Number of upcoming holidays to return (default 5, max 20)"),
				type: z
					.enum(HOLIDAY_TYPES)
					.optional()
					.describe("Filter by holiday type"),
			},
			async ({ from_date, limit, type }) =>
				handleGetUpcomingHolidays({ from_date, limit, type }, kv),
		);

		// ── Tool 4: is_working_day ────────────────────────────────────

		this.server.tool(
			"is_working_day",
			"Check if a specific date is a working day based on Philippine holiday proclamations. Does NOT account for weekends (Saturday/Sunday handling is the caller's responsibility).",
			{
				date: z
					.string()
					.describe("Date to check in ISO 8601 format: YYYY-MM-DD"),
			},
			async ({ date }) => handleIsWorkingDay({ date }, kv),
		);

		// ── Tool 5: get_long_weekends ─────────────────────────────────

		this.server.tool(
			"get_long_weekends",
			"Get all long weekend windows for a given year. A long weekend is 3+ consecutive non-working days (holidays + weekends). Also includes windows achievable with 1-2 bridge leave days.",
			{
				year: z
					.number()
					.int()
					.optional()
					.describe("Year to query (defaults to current year)"),
			},
			async ({ year }) => handleGetLongWeekends({ year }, kv),
		);
	}
}

const mcpHandler = HolidaysMCP.serve("/mcp");

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return mcpHandler.fetch(request, env, ctx);
		}

		return new Response(
			"PH Holidays MCP Server - Philippine national holiday data for LLMs.\nConnect via /mcp endpoint.",
			{ status: 200 },
		);
	},
};
