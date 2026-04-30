const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(process.cwd(), ".env") });

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "santa_emilia_shop",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD ?? ""
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction
};
