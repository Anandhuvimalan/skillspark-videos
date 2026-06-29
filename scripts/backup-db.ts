/**
 * Full raw-SQL backup of every table to a timestamped JSON, BEFORE the
 * batch-model `prisma db push`. Uses $queryRawUnsafe against information_schema
 * so it works regardless of the generated client's models (the old tables are
 * about to be dropped). npx tsx scripts/backup-db.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
let m: RegExpExecArray | null;
while ((m = re.exec(raw))) if (!(m[1] in process.env)) process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";

const prisma = new PrismaClient();

(async () => {
  const tables = (await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )).map((t) => t.table_name);

  const dump: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${t}"`);
    dump[t] = rows;
    console.log(`  ${String(rows.length).padStart(5)}  ${t}`);
  }

  const dir = resolve(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = resolve(dir, `backup-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(dump, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2),
    "utf8",
  );
  console.log(`\nBackup written: ${file}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
