import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./jobapplybot.db";
const client = createClient({ url });
export const db = drizzle(client, { schema });

export * from "./schema";
