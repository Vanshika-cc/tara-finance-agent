# DESIGN.md — Tara Finance Research Agent

## 1. Postgres Schema

### `transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | From source JSON |
| date | DATE | Indexed for range queries |
| merchant | TEXT | Raw merchant string |
| merchant_canonical | TEXT | Normalized/canonicalized name (indexed) |
| category | TEXT | Indexed; defaults to 'uncategorized' |
| amount | NUMERIC(12,2) | Negative = refund/reversal |
| currency | TEXT | Defaults to INR |
| memo | TEXT | Untrusted free text, never executed |

**Indexes:** `idx_txn_date`, `idx_txn_category`, `idx_txn_merchant`

### `funds`
One row per fund per NAV date (normalized NAV history).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | Fund ID |
| name | TEXT | Indexed for fuzzy search |
| category | TEXT | |
| nav_date | DATE | |
| nav_value | NUMERIC(12,4) | |

**Unique index:** `(id, nav_date)` — prevents duplicate NAV points.

### `holdings`
What the user owns.

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| fund_id | TEXT FK → funds.id | |
| fund_name | TEXT | Denormalized for fast display |
| units | NUMERIC(16,4) | |
| purchase_date | DATE | |
| purchase_nav | NUMERIC(12,4) | |

**Index:** `idx_holding_fund`

---

## 2. Tool Design

I chose **3 tools** instead of many narrow ones, following the assignment's guidance that fewer expressive tools beat many narrow ones:

| Tool | Purpose |
|------|---------|
| `query_transactions` | All spending questions — filtering by category, merchant, date, + aggregation modes |
| `query_funds` | Fund NAV lookup and period return computation |
| `query_holdings` | User's portfolio: realised return, current value, best performer |

**Why not more tools?** Every tool definition lives in the model's context on every turn. Overlapping tools cause tool selection errors. A single `query_transactions` with an `aggregate` parameter handles 80% of spending questions.

---

## 3. Grounding Guarantee

- The agent's system prompt explicitly states: "NEVER state a number you have not retrieved from a tool."
- All tools return `{ result: ... }` or `{ error: ... }` — the model is instructed to pass through the actual numbers, not restate them.
- Math (sums, averages, returns) is computed in SQL or JavaScript — the model does not do arithmetic. This makes results deterministic.

---

## 4. Formulas

### Net Spend
```
net_spend = SUM(amount)
```
Negative amounts (refunds) naturally reduce this. Gross spend = SUM where amount > 0.

### Merchant Canonical Matching
```
1. If memo matches UPI/[digits]/[MERCHANT]/... → extract MERCHANT
2. If memo matches NEFT... → extract merchant portion
3. Else: UPPERCASE → strip non-alpha → take first non-generic token
```
This handles "Swiggy", "SWIGGY*ORDER", "Swiggy Instamart", "UPI/123/SWIGGY/ybl" all resolving to "SWIGGY" without hardcoding aliases.

### Recurring Detection
A merchant is recurring if:
- Appears in ≥ 3 distinct months
- `STDDEV(amount) / AVG(amount) < 0.3` (consistent charge amounts)

### Fund Period Return
```
return_pct = ((nav_end - nav_start) / nav_start) * 100
```
We pick the closest available NAV ≤ the requested date (handles weekends/holidays).

### Holding Realised Return
```
purchase_cost = units × purchase_nav
current_value = units × latest_nav
realised_return_inr = current_value - purchase_cost
realised_return_pct = (realised_return_inr / purchase_cost) * 100
```
This is different from period return — it accounts for the user's specific entry point and number of units held.

---

## 5. Relative Date Handling

- "Last month" = most recent complete calendar month found in the transactions table.
- "March" without a year = most recent March in the data.
- "Q1 2025" = 2025-01-01 to 2025-03-31.
- All date resolution is documented inline in the tool query logic.

---

## 6. Evals

14 eval cases covering:
- Single category spend (E01)
- Top merchants ranking (E02)
- Merchant alias grouping (E03)
- Transfer exclusion (E04)
- Month-over-month comparison (E05)
- Recurring subscription detection (E06)
- No-data honest response (E07)
- Category comparison (E08)
- Fund period return (E09)
- Fund ranking + spread (E10)
- Portfolio worth (E11)
- Best holding (E12)
- Biggest expense (E13)
- Transfer total (E14)

Run: `npm run eval` (server must be running).

---

## 7. Observability

Each `/ask` request logs:
- `request_id` (UUID)
- Original question
- Tool calls in order with sanitized inputs (truncated, no secrets)
- Latency in ms
- Success/failure status + error message

Traces accessible at `GET /traces` (last 50 requests).

---

## 8. Async Milestone

**Not implemented** in this submission. All tools run synchronously. The tools complete well within typical response time (<2s for all queries on a local Postgres).

If I were to implement it: heavy portfolio computation across all holdings would return `{ job_id, status: "running" }`, a BullMQ worker would compute against Postgres, and the result would be fed back into a new agent turn via a synthetic system message.

---

## 9. Deployment

Deployed to [your-deployed-url]. Uses Neon (serverless Postgres) for the cloud database, same schema as local.

**Known limitations:**
- Free-tier cold start may add 1-2 seconds on first request
- In-memory traces are lost on restart (production would persist to DB)
- No auth on the `/ask` endpoint

---

## 10. Known Failure Modes & What I'd Fix With More Time

1. **Merchant canonicalization is heuristic** — taking the first token works for most cases but can fail for multi-word merchants like "Big Basket" (resolves to "BIG"). A better approach: cluster by edit distance in the ingest script.
2. **Relative dates** — "last month" is handled, but "last quarter" or "this year" would need more parsing logic.
3. **Multi-currency** — the tools assume INR. Mixed-currency portfolios would need per-currency aggregation.
4. **NAV gaps** — if a fund has no NAV data near the requested date, the tool returns an error. Interpolation or a wider search window would improve this.
5. **Non-determinism** — the same question can call different tools on different runs. More constrained tool descriptions and few-shot examples in the system prompt would improve consistency.
