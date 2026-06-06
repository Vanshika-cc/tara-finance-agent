import { Pool } from "pg";
import * as dotenv from "dotenv";
dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function setupSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id                  TEXT PRIMARY KEY,
        date                DATE NOT NULL,
        merchant            TEXT NOT NULL,
        merchant_canonical  TEXT NOT NULL,
        category            TEXT NOT NULL DEFAULT 'uncategorized',
        amount              NUMERIC(12,2) NOT NULL,
        currency            TEXT NOT NULL DEFAULT 'INR',
        memo                TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
      CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions(merchant_canonical);

      CREATE TABLE IF NOT EXISTS funds (
        id          TEXT NOT NULL,
        name        TEXT NOT NULL,
        category    TEXT,
        nav_date    DATE NOT NULL,
        nav_value   NUMERIC(12,4) NOT NULL,
        PRIMARY KEY (id, nav_date)
      );
      CREATE INDEX IF NOT EXISTS idx_fund_name ON funds(name);

      CREATE TABLE IF NOT EXISTS holdings (
        id            SERIAL PRIMARY KEY,
        fund_id       TEXT NOT NULL,
        fund_name     TEXT NOT NULL,
        units         NUMERIC(16,4) NOT NULL,
        purchase_date DATE NOT NULL,
        purchase_nav  NUMERIC(12,4) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_holding_fund ON holdings(fund_id);
    `);
    console.log("Schema ready");
  } finally {
    client.release();
  }
}