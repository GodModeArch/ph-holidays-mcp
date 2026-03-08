#!/usr/bin/env bash
# Thorough integration test for all 5 MCP tools
# Requires: wrangler dev running on port 8788 with seeded 2026 data

set -euo pipefail

BASE="http://localhost:8788/mcp"
PASS=0
FAIL=0
ERRORS=""

# ── Helper functions ───────────────────────────────────────────────

init_session() {
  local resp
  resp=$(curl -s -i -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
      "jsonrpc": "2.0",
      "id": 0,
      "method": "initialize",
      "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": { "name": "test-runner", "version": "1.0.0" }
      }
    }')
  echo "$resp" | grep -oP 'mcp-session-id: \K[a-f0-9]+'
}

call_tool() {
  local session_id="$1"
  local tool_name="$2"
  local args="$3"
  local id="${4:-1}"

  local raw
  raw=$(curl -s -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: $session_id" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": $id,
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"$tool_name\",
        \"arguments\": $args
      }
    }")

  # Extract the data line from SSE
  echo "$raw" | grep "^data:" | sed 's/^data: //'
}

# Extract content text from MCP response
get_content() {
  python3 -c "
import sys, json
resp = json.loads(sys.stdin.read())
print(resp['result']['content'][0]['text'])
"
}

# Assert a JSON path equals a value
assert_eq() {
  local test_name="$1"
  local actual="$2"
  local expected="$3"

  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  FAIL: $test_name (expected '$expected', got '$actual')"
    echo "  FAIL: $test_name (expected '$expected', got '$actual')"
  fi
}

assert_contains() {
  local test_name="$1"
  local haystack="$2"
  local needle="$3"

  if echo "$haystack" | grep -q "$needle"; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  FAIL: $test_name (expected to contain '$needle')"
    echo "  FAIL: $test_name (expected to contain '$needle')"
  fi
}

assert_not_contains() {
  local test_name="$1"
  local haystack="$2"
  local needle="$3"

  if ! echo "$haystack" | grep -q "$needle"; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  FAIL: $test_name (expected NOT to contain '$needle')"
    echo "  FAIL: $test_name (expected NOT to contain '$needle')"
  fi
}

assert_is_error() {
  local test_name="$1"
  local response="$2"

  local is_err
  is_err=$(echo "$response" | python3 -c "import sys,json; r=json.loads(sys.stdin.read()); print(r['result'].get('isError', False))" 2>/dev/null || echo "parse_error")

  if [ "$is_err" = "True" ]; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS="$ERRORS\n  FAIL: $test_name (expected isError: true)"
    echo "  FAIL: $test_name (expected isError: true)"
  fi
}

# ── Initialize session ────────────────────────────────────────────

echo "=== Initializing MCP session ==="
SESSION=$(init_session)
if [ -z "$SESSION" ]; then
  echo "FATAL: Could not establish MCP session"
  exit 1
fi
echo "Session: ${SESSION:0:16}..."
echo ""

# ══════════════════════════════════════════════════════════════════
# TOOL 1: get_holidays
# ══════════════════════════════════════════════════════════════════
echo "=== Tool 1: get_holidays ==="

# 1a. All holidays for 2026
RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "All 2026 holidays count" "$COUNT" "21"

# 1b. Regular only
RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026, "type": "regular"}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Regular holidays count" "$COUNT" "10"

# 1c. Special non-working only
RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026, "type": "special_non_working"}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Special non-working count" "$COUNT" "8"

# 1d. Special working only
RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026, "type": "special_working"}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Special working count" "$COUNT" "1"
NAME=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data'][0]['name'])")
assert_eq "Special working is EDSA" "$NAME" "EDSA People Power Revolution Anniversary"

# 1e. Islamic only
RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026, "type": "islamic"}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Islamic holidays count" "$COUNT" "2"

# 1f. Meta envelope present
META_YEAR=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['_meta']['year'])")
assert_eq "Meta year in envelope" "$META_YEAR" "2026"
META_SRC=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['_meta']['source'])")
assert_contains "Meta source" "$META_SRC" "Official Gazette"

# 1g. Sorted by date
RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026}')
CONTENT=$(echo "$RESP" | get_content)
SORTED=$(echo "$CONTENT" | python3 -c "
import sys,json
data = json.loads(sys.stdin.read())['data']
dates = [h['date'] for h in data]
print('true' if dates == sorted(dates) else 'false')
")
assert_eq "Holidays sorted by date" "$SORTED" "true"

# 1h. Invalid year (error path)
RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 1999}')
assert_is_error "Invalid year returns error" "$RESP"

echo ""

# ══════════════════════════════════════════════════════════════════
# TOOL 2: get_holiday_by_date
# ══════════════════════════════════════════════════════════════════
echo "=== Tool 2: get_holiday_by_date ==="

# 2a. Known regular holiday (Christmas)
RESP=$(call_tool "$SESSION" "get_holiday_by_date" '{"date": "2026-12-25"}')
CONTENT=$(echo "$RESP" | get_content)
IS_HOL=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_holiday'])")
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
assert_eq "Christmas is holiday" "$IS_HOL" "True"
assert_eq "Christmas is not working" "$IS_WORK" "False"

# 2b. Holiday name correct
H_NAME=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday']['name'])")
assert_eq "Christmas name" "$H_NAME" "Christmas Day"

# 2c. Day of week correct
DOW=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday']['day_of_week'])")
assert_eq "Christmas day_of_week" "$DOW" "Friday"

# 2d. Special working day (EDSA)
RESP=$(call_tool "$SESSION" "get_holiday_by_date" '{"date": "2026-02-25"}')
CONTENT=$(echo "$RESP" | get_content)
IS_HOL=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_holiday'])")
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
assert_eq "EDSA is holiday" "$IS_HOL" "True"
assert_eq "EDSA is working day" "$IS_WORK" "True"

# 2e. Non-holiday date
RESP=$(call_tool "$SESSION" "get_holiday_by_date" '{"date": "2026-07-15"}')
CONTENT=$(echo "$RESP" | get_content)
IS_HOL=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_holiday'])")
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
H_NULL=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday'])")
assert_eq "Jul 15 not holiday" "$IS_HOL" "False"
assert_eq "Jul 15 is working" "$IS_WORK" "True"
assert_eq "Jul 15 holiday is null" "$H_NULL" "None"

# 2f. Islamic holiday has eid fields
RESP=$(call_tool "$SESSION" "get_holiday_by_date" '{"date": "2026-03-20"}')
CONTENT=$(echo "$RESP" | get_content)
EID_CONF=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday']['eid_confirmed'])")
EST_DATE=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday']['estimated_date'])")
CONF_DATE=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday']['confirmed_date'])")
PROC_REF=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday']['proclamation_ref'])")
assert_eq "Eid Fitr eid_confirmed" "$EID_CONF" "False"
assert_eq "Eid Fitr estimated_date" "$EST_DATE" "2026-03-20"
assert_eq "Eid Fitr confirmed_date null" "$CONF_DATE" "None"
assert_eq "Eid Fitr proclamation_ref null" "$PROC_REF" "None"

# 2g. Invalid year in date (error path)
RESP=$(call_tool "$SESSION" "get_holiday_by_date" '{"date": "2020-01-01"}')
assert_is_error "Date in unsupported year returns error" "$RESP"

# 2h. Every single 2026 holiday resolves by date
echo "  Checking all 21 holidays resolve by per-date KV lookup..."
ALL_DATES=$(call_tool "$SESSION" "get_holidays" '{"year": 2026}' | get_content | python3 -c "
import sys,json
data = json.loads(sys.stdin.read())['data']
for h in data:
    print(h['date'])
")
DATE_MISS=0
while IFS= read -r dt; do
  R=$(call_tool "$SESSION" "get_holiday_by_date" "{\"date\": \"$dt\"}")
  C=$(echo "$R" | get_content)
  IH=$(echo "$C" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_holiday'])")
  if [ "$IH" != "True" ]; then
    DATE_MISS=$((DATE_MISS + 1))
    echo "    MISS: $dt"
  fi
done <<< "$ALL_DATES"
assert_eq "All 21 holidays resolve by date" "$DATE_MISS" "0"

echo ""

# ══════════════════════════════════════════════════════════════════
# TOOL 3: get_upcoming_holidays
# ══════════════════════════════════════════════════════════════════
echo "=== Tool 3: get_upcoming_holidays ==="

# 3a. Default limit (5)
RESP=$(call_tool "$SESSION" "get_upcoming_holidays" '{"from_date": "2026-01-01"}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Default limit returns 5" "$COUNT" "5"

# 3b. First upcoming from Jan 1 is Jan 1 itself
FIRST=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data'][0]['date'])")
assert_eq "Jan 1 upcoming includes Jan 1" "$FIRST" "2026-01-01"

# 3c. Custom limit
RESP=$(call_tool "$SESSION" "get_upcoming_holidays" '{"from_date": "2026-01-01", "limit": 3}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Custom limit 3" "$COUNT" "3"

# 3d. From mid-year
RESP=$(call_tool "$SESSION" "get_upcoming_holidays" '{"from_date": "2026-06-01", "limit": 3}')
CONTENT=$(echo "$RESP" | get_content)
FIRST=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data'][0]['name'])")
assert_eq "First from Jun 1 is Independence Day" "$FIRST" "Independence Day"

# 3e. Type filter
RESP=$(call_tool "$SESSION" "get_upcoming_holidays" '{"from_date": "2026-01-01", "limit": 20, "type": "islamic"}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Islamic upcoming count" "$COUNT" "2"

# 3f. From after last holiday (should return empty or few)
RESP=$(call_tool "$SESSION" "get_upcoming_holidays" '{"from_date": "2026-12-31", "limit": 5}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "From Dec 31 gets Last Day of Year" "$COUNT" "1"

# 3g. From after all holidays
RESP=$(call_tool "$SESSION" "get_upcoming_holidays" '{"from_date": "2027-01-01", "limit": 5}')
assert_is_error "Future year with no data returns error" "$RESP"

# 3h. Max limit cap
RESP=$(call_tool "$SESSION" "get_upcoming_holidays" '{"from_date": "2026-01-01", "limit": 20}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']))")
assert_eq "Max limit 20 returns all 21 capped at 20" "$COUNT" "20"

echo ""

# ══════════════════════════════════════════════════════════════════
# TOOL 4: is_working_day
# ══════════════════════════════════════════════════════════════════
echo "=== Tool 4: is_working_day ==="

# 4a. Regular holiday
RESP=$(call_tool "$SESSION" "is_working_day" '{"date": "2026-01-01"}')
CONTENT=$(echo "$RESP" | get_content)
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
REASON=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['reason'])")
HTYPE=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday_type'])")
assert_eq "New Year not working" "$IS_WORK" "False"
assert_contains "New Year reason" "$REASON" "Regular Holiday"
assert_eq "New Year type" "$HTYPE" "regular"

# 4b. Special non-working
RESP=$(call_tool "$SESSION" "is_working_day" '{"date": "2026-11-01"}')
CONTENT=$(echo "$RESP" | get_content)
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
REASON=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['reason'])")
assert_eq "All Saints not working" "$IS_WORK" "False"
assert_contains "All Saints reason" "$REASON" "Special Non-Working"

# 4c. Special working (EDSA)
RESP=$(call_tool "$SESSION" "is_working_day" '{"date": "2026-02-25"}')
CONTENT=$(echo "$RESP" | get_content)
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
REASON=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['reason'])")
assert_eq "EDSA is working" "$IS_WORK" "True"
assert_contains "EDSA reason" "$REASON" "Special Working Day"

# 4d. Islamic holiday
RESP=$(call_tool "$SESSION" "is_working_day" '{"date": "2026-05-27"}')
CONTENT=$(echo "$RESP" | get_content)
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
REASON=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['reason'])")
assert_eq "Eid Adha not working" "$IS_WORK" "False"
assert_contains "Eid Adha reason" "$REASON" "Islamic Holiday"

# 4e. Ordinary weekday
RESP=$(call_tool "$SESSION" "is_working_day" '{"date": "2026-03-10"}')
CONTENT=$(echo "$RESP" | get_content)
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
REASON=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['reason'])")
HTYPE=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['holiday_type'])")
assert_eq "Mar 10 is working" "$IS_WORK" "True"
assert_eq "Mar 10 reason" "$REASON" "No holiday on this date"
assert_eq "Mar 10 type null" "$HTYPE" "None"

# 4f. Weekend (Saturday) - should still return true per spec (no weekend logic)
RESP=$(call_tool "$SESSION" "is_working_day" '{"date": "2026-03-14"}')
CONTENT=$(echo "$RESP" | get_content)
IS_WORK=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['data']['is_working_day'])")
assert_eq "Saturday returns working (no weekend logic)" "$IS_WORK" "True"

# 4g. Invalid year
RESP=$(call_tool "$SESSION" "is_working_day" '{"date": "2030-01-01"}')
assert_is_error "Unsupported year returns error" "$RESP"

echo ""

# ══════════════════════════════════════════════════════════════════
# TOOL 5: get_long_weekends
# ══════════════════════════════════════════════════════════════════
echo "=== Tool 5: get_long_weekends ==="

# 5a. Returns windows
RESP=$(call_tool "$SESSION" "get_long_weekends" '{"year": 2026}')
CONTENT=$(echo "$RESP" | get_content)
COUNT=$(echo "$CONTENT" | python3 -c "import sys,json; print(len(json.loads(sys.stdin.read())['data']['long_weekends']))")
assert_eq "Long weekend windows count > 0" "$([ "$COUNT" -gt 0 ] && echo true || echo false)" "true"

# 5b. Holy Week is a natural long weekend (Apr 2-5: Thu-Fri-Sat-Sun)
HOLY_WEEK=$(echo "$CONTENT" | python3 -c "
import sys,json
ws = json.loads(sys.stdin.read())['data']['long_weekends']
hw = [w for w in ws if w['window_start'] == '2026-04-02' and w['leave_days_needed'] == 0]
if hw:
    w = hw[0]
    print(f\"{w['window_start']}|{w['window_end']}|{w['days']}|{w['leave_days_needed']}\")
else:
    print('NOT_FOUND')
")
assert_eq "Holy Week window" "$HOLY_WEEK" "2026-04-02|2026-04-05|4|0"

# 5c. Holy Week includes 3 holidays
HW_HOLIDAYS=$(echo "$CONTENT" | python3 -c "
import sys,json
ws = json.loads(sys.stdin.read())['data']['long_weekends']
hw = [w for w in ws if w['window_start'] == '2026-04-02' and w['leave_days_needed'] == 0]
if hw:
    print(len(hw[0]['holidays_included']))
else:
    print(0)
")
assert_eq "Holy Week has 3 holidays" "$HW_HOLIDAYS" "3"

# 5d. Christmas long weekend (Dec 24-27: Thu-Fri-Sat-Sun, natural)
XMAS=$(echo "$CONTENT" | python3 -c "
import sys,json
ws = json.loads(sys.stdin.read())['data']['long_weekends']
xw = [w for w in ws if w['window_start'] == '2026-12-24' and w['leave_days_needed'] == 0]
if xw:
    w = xw[0]
    print(f\"{w['window_start']}|{w['window_end']}|{w['days']}\")
else:
    print('NOT_FOUND')
")
assert_eq "Christmas natural window" "$XMAS" "2026-12-24|2026-12-27|4"

# 5e. Bridge window exists (New Year: Jan 1 Thu + bridge Fri + Sat-Sun)
NY_BRIDGE=$(echo "$CONTENT" | python3 -c "
import sys,json
ws = json.loads(sys.stdin.read())['data']['long_weekends']
nw = [w for w in ws if w['window_start'] == '2026-01-01' and w['leave_days_needed'] > 0]
if nw:
    w = nw[0]
    print(f\"{w['days']}|{w['leave_days_needed']}\")
else:
    print('NOT_FOUND')
")
assert_eq "New Year bridge window" "$NY_BRIDGE" "4|1"

# 5f. All windows sorted by date
SORTED=$(echo "$CONTENT" | python3 -c "
import sys,json
ws = json.loads(sys.stdin.read())['data']['long_weekends']
starts = [w['window_start'] for w in ws]
print('true' if starts == sorted(starts) else 'false')
")
assert_eq "Long weekends sorted" "$SORTED" "true"

# 5g. All windows have dates array matching days count
DATES_MATCH=$(echo "$CONTENT" | python3 -c "
import sys,json
ws = json.loads(sys.stdin.read())['data']['long_weekends']
all_match = all(len(w['dates']) == w['days'] for w in ws)
print('true' if all_match else 'false')
")
assert_eq "All windows dates.length == days" "$DATES_MATCH" "true"

# 5h. Invalid year
RESP=$(call_tool "$SESSION" "get_long_weekends" '{"year": 2030}')
assert_is_error "Invalid year returns error" "$RESP"

echo ""

# ══════════════════════════════════════════════════════════════════
# SCHEMA CHECKS: field presence on every record
# ══════════════════════════════════════════════════════════════════
echo "=== Schema: field presence on all records ==="

RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026}')
CONTENT=$(echo "$RESP" | get_content)

# Check all base fields present on every record
FIELD_CHECK=$(echo "$CONTENT" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())['data']
required = ['date', 'name', 'type', 'day_of_week', 'movable', 'double_holiday',
            'double_holiday_names', 'long_weekend', 'source', 'notes']
lw_required = ['is_part_of', 'window_start', 'window_end', 'days', 'leave_days_needed', 'dates']
source_required = ['proclamation', 'signed_date', 'authority']
islamic_required = ['eid_confirmed', 'estimated_date', 'confirmed_date', 'proclamation_ref']

errors = []
for h in data:
    for f in required:
        if f not in h:
            errors.append(f'{h[\"name\"]}: missing {f}')
    for f in lw_required:
        if f not in h.get('long_weekend', {}):
            errors.append(f'{h[\"name\"]}: long_weekend missing {f}')
    for f in source_required:
        if f not in h.get('source', {}):
            errors.append(f'{h[\"name\"]}: source missing {f}')
    if h['type'] == 'islamic':
        for f in islamic_required:
            if f not in h:
                errors.append(f'{h[\"name\"]}: islamic missing {f}')

print(len(errors))
for e in errors[:10]:
    print(f'  {e}')
")
FIELD_ERRORS=$(echo "$FIELD_CHECK" | head -1)
assert_eq "All records have required fields" "$FIELD_ERRORS" "0"

# Check no records have double_holiday true (none in 2026)
DOUBLE_COUNT=$(echo "$CONTENT" | python3 -c "
import sys,json
data = json.loads(sys.stdin.read())['data']
print(sum(1 for h in data if h['double_holiday']))
")
assert_eq "No double holidays in 2026" "$DOUBLE_COUNT" "0"

# Check movable only on National Heroes Day and Eid holidays
MOVABLE=$(echo "$CONTENT" | python3 -c "
import sys,json
data = json.loads(sys.stdin.read())['data']
movable = [h['name'] for h in data if h['movable']]
print('|'.join(sorted(movable)))
")
assert_eq "Movable holidays" "$MOVABLE" "Eid'l Adha|Eid'l Fitr|National Heroes Day"

echo ""

# ══════════════════════════════════════════════════════════════════
# DAY OF WEEK VALIDATION
# ══════════════════════════════════════════════════════════════════
echo "=== Day of week correctness ==="

DOW_CHECK=$(echo "$CONTENT" | python3 -c "
import sys, json
from datetime import date

data = json.loads(sys.stdin.read())['data']
days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
errors = 0
for h in data:
    y, m, d = map(int, h['date'].split('-'))
    actual = days[date(y, m, d).weekday()]
    if actual != h['day_of_week']:
        print(f'  WRONG: {h[\"name\"]} {h[\"date\"]}: expected {actual}, got {h[\"day_of_week\"]}')
        errors += 1
print(errors)
")
DOW_ERRORS=$(echo "$DOW_CHECK" | tail -1)
assert_eq "All day_of_week values correct" "$DOW_ERRORS" "0"

echo ""

# ══════════════════════════════════════════════════════════════════
# META / INDEX CONSISTENCY
# ══════════════════════════════════════════════════════════════════
echo "=== Meta consistency ==="

RESP=$(call_tool "$SESSION" "get_holidays" '{"year": 2026}')
CONTENT=$(echo "$RESP" | get_content)

META_EID_FITR=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['_meta']['eid_fitr_status'])")
META_EID_ADHA=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['_meta']['eid_adha_status'])")
assert_eq "Meta eid_fitr_status" "$META_EID_FITR" "pending"
assert_eq "Meta eid_adha_status" "$META_EID_ADHA" "pending"

META_PROC=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['_meta']['proclamation'])")
assert_eq "Meta proclamation" "$META_PROC" "No. 1006"

META_TIER=$(echo "$CONTENT" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['_meta']['tier'])")
assert_eq "Meta tier" "$META_TIER" "current"

echo ""

# ══════════════════════════════════════════════════════════════════
# RESULTS
# ══════════════════════════════════════════════════════════════════
echo "════════════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures:"
  echo -e "$ERRORS"
  exit 1
fi
