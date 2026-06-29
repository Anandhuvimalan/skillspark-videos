/**
 * Deletes ALL students (cascades to StudentBatch + VideoProgress). Writes an
 * audit log. Dry-run by default; pass --commit to actually delete.
 *   npx tsx scripts/delete-all-students.ts            # dry run (counts only)
 *   npx tsx scripts/delete-all-students.ts --commit
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
let m: RegExpExecArray | null;
while ((m = re.exec(raw))) if (!(m[1] in process.env)) process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";

const COMMIT = process.argv.includes("--commit");
const prisma = new PrismaClient();

(async () => {
  const [students, memberships, progress] = await Promise.all([
    prisma.student.count(),
    prisma.studentBatch.count(),
    prisma.videoProgress.count(),
  ]);
  console.log(`Will delete: ${students} students (cascades: ${memberships} batch memberships, ${progress} progress rows).`);

  if (!COMMIT) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --commit.");
    await prisma.$disconnect();
    return;
  }

  const r = await prisma.student.deleteMany({});
  await prisma.auditLog.create({
    data: {
      actorType: "system",
      actorEmail: process.env.SEED_ADMIN_EMAIL ?? null,
      action: "STUDENT_DELETED",
      entityType: "Student",
      oldValue: JSON.stringify({ deletedAll: true, count: r.count, source: "delete-all-students-script" }),
    },
  });

  const remaining = await prisma.student.count();
  console.log(`\nDeleted ${r.count} students. Remaining: ${remaining}.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
