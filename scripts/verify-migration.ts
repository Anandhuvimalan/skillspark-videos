/** Confirms the batch-model migration. npx tsx scripts/verify-migration.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
let m: RegExpExecArray | null;
while ((m = re.exec(raw))) if (!(m[1] in process.env)) process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";

const prisma = new PrismaClient();
(async () => {
  const [students, batches, courses, batchCourses, studentBatches, videos, progress, audit] =
    await Promise.all([
      prisma.student.count(),
      prisma.batch.count(),
      prisma.course.count(),
      prisma.batchCourse.count(),
      prisma.studentBatch.count(),
      prisma.video.count(),
      prisma.videoProgress.count(),
      prisma.auditLog.count(),
    ]);
  console.log({ students, batches, courses, batchCourses, studentBatches, videos, progress, audit });

  const dropped = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('Package','PackageCourse','StudentPackage','BatchPackage','StudentCourse','StudentCourseDenial')`,
  );
  const hasStudentBatch = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='StudentBatch'`,
  );
  console.log(`Old tables still present: ${dropped.map((d) => d.table_name).join(", ") || "none ✓"}`);
  console.log(`StudentBatch table exists: ${hasStudentBatch.length > 0 ? "yes ✓" : "NO ✗"}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
