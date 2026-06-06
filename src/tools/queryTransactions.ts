import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pool } from "../db";

/**
 * query_transactions: one flexible tool for all spending questions.
 * Filters: category, merchant (fuzzy canonical match), date range, exclude_transfers
 * Aggregation: none (return rows), sum, average, count, top_merchants, monthly_breakdown
 */
export const queryTransactionsTool = createTool({
  id: "query_transactions",
  description: `Query the user's transactions. Supports filtering by category, merchant name (fuzzy),
and date range. Supports aggregation modes: 'sum' (total spend), 'top_merchants' (ranked by net spend),
'monthly_breakdown' (totals per month), 'recurring' (detect subscription-like patterns), or 'rows' (raw list).
Always excludes internal transfers by default (category = 'transfer') unless include_transfers is true.
Refunds (negative amounts) are always included in net spend calculations.`,
  inputSchema: z.object({
    // Filters
    category: z.string().optional().describe("Category to filter by, e.g. 'food', 'travel'"),
    merchant: z.string().optional().describe("Merchant name (partial/fuzzy match), e.g. 'Swiggy'"),
    date_from: z.string().optional().describe("Start date inclusive, YYYY-MM-DD"),
    date_to: z.string().optional().describe("End date inclusive, YYYY-MM-DD"),
    year_month: z.string().optional().describe("Shorthand for a full month, e.g. '2025-03' for March 2025"),
    include_transfers: z.boolean().optional().default(false).describe("Include transfer transactions (default false)"),
    // Aggregation
    aggregate: z
  .enum(["none", "rows", "sum", "average", "top_merchants", "monthly_breakdown", "recurring", "category_breakdown", "compare"])
  .optional()
  .default("none")
  .describe("How to aggregate results"),
limit: z.number().optional().default(10).describe("Max rows to return for 'none' or 'top_merchants'"),
  }),

  execute: async ({ context }) => {
    const {
      category,
      merchant,
      date_from,
      date_to,
      year_month,
      include_transfers,
      aggregate,
      limit,
    } = context;

    const conditions: string[] = [];
    const params: any[] = [];
    let p = 1;

    // Exclude transfers unless asked
    if (!include_transfers) {
      conditions.push(`LOWER(category) != 'transfer'`);
    }

    // Category filter
    if (category) {
      conditions.push(`LOWER(category) = LOWER($${p++})`);
      params.push(category);
    }

    // Merchant filter - match on canonical name (first token) for alias grouping
    if (merchant) {
      const canonical = merchant.toUpperCase().replace(/[^A-Z\s]/g, " ").trim().split(/\s+/)[0];
      conditions.push(`merchant_canonical ILIKE $${p++}`);
      params.push(`%${canonical}%`);
    }

    // Date range
    let resolvedFrom = date_from;
    let resolvedTo = date_to;
    if (year_month) {
      const [yr, mo] = year_month.split("-").map(Number);
      const lastDay = new Date(yr, mo, 0).getDate();
      resolvedFrom = `${year_month}-01`;
      resolvedTo = `${year_month}-${String(lastDay).padStart(2, "0")}`;
    }
    if (resolvedFrom) {
      conditions.push(`date >= $${p++}`);
      params.push(resolvedFrom);
    }
    if (resolvedTo) {
      conditions.push(`date <= $${p++}`);
      params.push(resolvedTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    try {
      if (aggregate === "sum") {
        const res = await pool.query(
          `SELECT
             COUNT(*)::int as transaction_count,
             ROUND(SUM(amount)::numeric, 2) as total_spend,
             ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)::numeric, 2) as gross_spend,
             ROUND(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)::numeric, 2) as total_refunds
           FROM transactions ${whereClause}`,
          params
        );
        return { result: res.rows[0] };
      }

      if (aggregate === "top_merchants") {
        const res = await pool.query(
          `SELECT
             merchant_canonical as merchant,
             COUNT(*)::int as transaction_count,
             ROUND(SUM(amount)::numeric, 2) as net_spend
           FROM transactions ${whereClause}
           GROUP BY merchant_canonical
           ORDER BY SUM(amount) DESC
           LIMIT $${p++}`,
          [...params, limit || 10]
        );
        return { result: res.rows };
      }

      if (aggregate === "monthly_breakdown") {
        const res = await pool.query(
          `SELECT
             TO_CHAR(date, 'YYYY-MM') as month,
             ROUND(SUM(amount)::numeric, 2) as net_spend,
             COUNT(*)::int as transaction_count
           FROM transactions ${whereClause}
           GROUP BY TO_CHAR(date, 'YYYY-MM')
           ORDER BY month`,
          params
        );
        return { result: res.rows };
      }

      if (aggregate === "category_breakdown") {
        const res = await pool.query(
          `SELECT
             category,
             ROUND(SUM(amount)::numeric, 2) as net_spend,
             COUNT(*)::int as transaction_count
           FROM transactions ${whereClause}
           GROUP BY category
           ORDER BY SUM(amount) DESC`,
          params
        );
        return { result: res.rows };
      }

      if (aggregate === "recurring") {
        // Recurring = merchant appears 2+ months in a row with similar amounts
        const res = await pool.query(
          `SELECT
             merchant_canonical as merchant,
             COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) as months_appeared,
             ROUND(AVG(amount)::numeric, 2) as avg_amount,
             ROUND(MIN(amount)::numeric, 2) as min_amount,
             ROUND(MAX(amount)::numeric, 2) as max_amount,
             COUNT(*)::int as total_transactions
           FROM transactions ${whereClause}
           GROUP BY merchant_canonical
           HAVING COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM')) >= 3
             AND STDDEV(amount) / NULLIF(AVG(amount), 0) < 0.3
           ORDER BY months_appeared DESC`,
          params
        );
        return { result: res.rows };
      }

      // Default: raw rows
      const res = await pool.query(
        `SELECT id, date, merchant, merchant_canonical, category, amount, currency, memo
         FROM transactions ${whereClause}
         ORDER BY date DESC
         LIMIT $${p++}`,
        [...params, limit || 50]
      );
      return { result: res.rows, total_rows: res.rowCount };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
