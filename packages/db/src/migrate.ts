import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";

import { createDatabase } from "./client.js";

const database = createDatabase();

try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url))
  });
} finally {
  await database.close();
}
