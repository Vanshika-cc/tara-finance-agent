
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { pool, setupSchema } from "../src/db";
dotenv.config();

const DATA_DIR = process.argv[2] || process.env.DATA_DIR || "./data/sample_a";


function canonicalizeMerchant(raw: string): string {
  // Strip UPI/NEFT metadata: "UPI/12345/SWIGGY/ybl" → "SWIGGY"
  const upiMatch = raw.match(/UPI\/\d+\/([^\/]+)/i);
  if (upiMatch) return upiMatch[1].toUpperCase().trim();

  const neftMatch = raw.match(/NEFT[- \/][\w]+[- \/]([A-Z ]+)/i);
  if (neftMatch) return neftMatch[1].toUpperCase().trim();

  // Remove non-alpha characters (*, @, numbers), collapse spaces, uppercase
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Take the first token as the canonical name (e.g. "SWIGGY INSTAMART" → "SWIGGY")
  // BUT if first token is a very generic word, take first two tokens
  const tokens = cleaned.split(" ").filter(Boolean);
  const generic = new Set(["THE", "A", "AN", "MY", "POS", "PAYMENT", "TRANSFER"]);
  if (tokens.length === 0) return raw.toUpperCase().trim();
  if (generic.has(tokens[0]) && tokens.length > 1) return tokens.slice(0, 2).join(" ");
  return tokens[0];
}

async function ingestTransactions(dataDir: string) {
  const filePath = path.join(dataDir, "transactions.json");
  if (!fs.existsSync(filePath)) {
    console.error(`❌ transactions.json not found at ${filePath}`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const client = await pool.connect();
  try {
    // Clear existing data for clean re-ingest
    await client.query("DELETE FROM transactions");

    let count = 0;
    for (const t of raw) {
      const canonical = canonicalizeMerchant(t.merchant || "");
      await client.query(
        `INSERT INTO transactions (id, date, merchant, category, amount, currency, memo, merchant_canonical)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           date = EXCLUDED.date,
           merchant = EXCLUDED.merchant,
           category = EXCLUDED.category,
           amount = EXCLUDED.amount,
           currency = EXCLUDED.currency,
           memo = EXCLUDED.memo,
           merchant_canonical = EXCLUDED.merchant_canonical`,
        [
          t.id,
          t.date,
          t.merchant || "",
          t.category || "uncategorized",
          t.amount,
          t.currency || "INR",
          t.memo || null,
          canonical,
        ]
      );
      count++;
    }
    console.log(`Ingested ${count} transactions`);
  } finally {
    client.release();
  }
}

async function ingestFunds(dataDir: string) {
  const filePath = path.join(dataDir, "funds.json");
  if (!fs.existsSync(filePath)) {
    console.error(`funds.json not found at ${filePath}`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const client = await pool.connect();
  try {
   await client.query("DROP TABLE IF EXISTS holdings");
await client.query("DROP TABLE IF EXISTS funds");
await client.query(`
  CREATE TABLE funds (
    id TEXT NOT NULL, name TEXT NOT NULL, category TEXT,
    nav_date DATE NOT NULL, nav_value NUMERIC(12,4) NOT NULL,
    PRIMARY KEY (id, nav_date)
  )
`);
await client.query(`
  CREATE TABLE IF NOT EXISTS holdings (
    id SERIAL PRIMARY KEY, fund_id TEXT NOT NULL, fund_name TEXT NOT NULL,
    units NUMERIC(16,4) NOT NULL, purchase_date DATE NOT NULL, purchase_nav NUMERIC(12,4) NOT NULL
  )
`);

    let count = 0;
    for (const fund of raw) {
      // JSON shape: fund.nav = [{ date: "YYYY-MM-DD", value: 101.24 }]
      const navHistory: { date: string; value: number }[] = fund.nav || fund.nav_history || [];
      for (const point of navHistory) {
        const navValue = point.value ?? (point as any).nav; // handle either field name
        await client.query(
          `INSERT INTO funds (id, name, category, nav_date, nav_value)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id, nav_date) DO UPDATE SET nav_value = EXCLUDED.nav_value`,
          [fund.id, fund.name, fund.category || null, point.date, navValue]
        );
        count++;
      }
    }
    console.log(`Ingested ${count} fund NAV records`);
  } finally {
    client.release();
  }
}

async function ingestHoldings(dataDir: string) {
  const filePath = path.join(dataDir, "holdings.json");
  if (!fs.existsSync(filePath)) {
    console.error(`holdings.json not found at ${filePath}`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM holdings");

    let count = 0;
    for (const h of raw) {
      await client.query(
        `INSERT INTO holdings (fund_id, fund_name, units, purchase_date, purchase_nav)
         VALUES ($1, $2, $3, $4, $5)`,
        [h.fund_id, h.fund_name, h.units, h.purchase_date, h.purchase_nav]
      );
      count++;
    }
    console.log(`Ingested ${count} holdings`);
  } finally {
    client.release();
  }
}

async function main() {
  const absDir = path.resolve(DATA_DIR);
  console.log(`Ingesting from: ${absDir}`);

  if (!fs.existsSync(absDir)) {
    console.error(`Directory not found: ${absDir}`);
    process.exit(1);
  }

  await setupSchema();
  await ingestTransactions(absDir);
  await ingestFunds(absDir);
  await ingestHoldings(absDir);

  console.log("Ingest complete");
  await pool.end();
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});