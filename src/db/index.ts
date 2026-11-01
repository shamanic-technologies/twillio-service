import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { normalizeSslMode } from "./utils";

const connectionString = process.env.TWILIO_SERVICE_DATABASE_URL;

if (!connectionString) {
  throw new Error("TWILIO_SERVICE_DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: normalizeSslMode(connectionString),
  // PG-CONN-1101: 5 is the fleet budget; measured peak concurrent use 0-3, the box Postgres has 300 slots shared by ~30 pools. pg queues beyond max, it does not fail.
  max: 5,
});

// An idle client killed server-side emits "error" on the pool; without a
// listener that crashes the process.
pool.on("error", (err) => console.error("[twilio-service] idle pg client error", err));

export const db = drizzle(pool, { schema });
export { pool };
