/**
 * Populates KB_ARTICLES.EMBEDDING using Ollama nomic-embed-text.
 * Usage: bun run src/scripts/populate_vectors.ts
 *
 * Env vars (or edit defaults below):
 *   DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_SERVICE
 *   OLLAMA_URL, OLLAMA_MODEL
 *   TABLE_OWNER, TABLE_NAME, TEXT_COLUMN, VECTOR_COLUMN
 */

import oracledb from "oracledb";
import { embedText } from "../embedding.ts";

const DB_USER     = process.env.DB_USER     ?? "SYSTEM";
const DB_PASSWORD = process.env.DB_PASSWORD ?? "oracle";
const DB_HOST     = process.env.DB_HOST     ?? "localhost";
const DB_PORT     = Number(process.env.DB_PORT ?? "1521");
const DB_SERVICE  = process.env.DB_SERVICE  ?? "FREEPDB1";

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "nomic-embed-text";

const TABLE_OWNER   = process.env.TABLE_OWNER   ?? "SYSTEM";
const TABLE_NAME    = process.env.TABLE_NAME    ?? "KB_ARTICLES";
const TEXT_COLUMN   = process.env.TEXT_COLUMN   ?? "CONTENT";
const VECTOR_COLUMN = process.env.VECTOR_COLUMN ?? "EMBEDDING";

async function main() {
  const conn = await oracledb.getConnection({
    user: DB_USER,
    password: DB_PASSWORD,
    connectString: `${DB_HOST}:${DB_PORT}/${DB_SERVICE}`,
  });

  const result = await conn.execute<[number, string]>(
    `SELECT ID, ${TEXT_COLUMN} FROM ${TABLE_OWNER}.${TABLE_NAME} WHERE ${VECTOR_COLUMN} IS NULL ORDER BY ID`,
    [],
    { outFormat: oracledb.OUT_FORMAT_ARRAY },
  );

  const rows = result.rows ?? [];
  console.log(`Found ${rows.length} rows to embed.`);

  for (const [id, text] of rows) {
    process.stdout.write(`  ID=${id} …`);
    const vector = await embedText({
      provider: "ollama",
      model: OLLAMA_MODEL,
      baseUrl: OLLAMA_URL,
      text: String(text),
    });
    const vecStr = `[${vector.join(",")}]`;
    await conn.execute(
      `UPDATE ${TABLE_OWNER}.${TABLE_NAME} SET ${VECTOR_COLUMN} = TO_VECTOR(:v) WHERE ID = :id`,
      { v: vecStr, id },
    );
    console.log(` ✓ (${vector.length} dims)`);
  }

  await conn.commit();
  await conn.close();
  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });
