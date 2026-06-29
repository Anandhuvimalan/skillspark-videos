/** Read-only snapshot of the access-model tables. npx tsx scripts/model-stats.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const re = /^([A-Z0-9_]+)=(?:'([\s\S]*?)'|"([^"]*)"|(.*))$/gm;
let m: RegExpExecArray | null;
while ((m = re.exec(raw))) if (!(m[1] in process.env)) process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";

const prisma = new PrismaClient();
(async () => {
  const [
    students, studentsWithBatch, batches, courses,
    studentCourses, packages, packageCourses, studentPackages,
    batchCourses, batchPackages, denials,
  ] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({ where: { batchId: { not: null } } }),
    prisma.batch.count(),
    prisma.course.count(),
    prisma.studentCourse.count(),
    prisma.package.count(),
    prisma.packageCourse.count(),
    prisma.studentPackage.count(),
    prisma.batchCourse.count(),
    prisma.batchPackage.count(),
    prisma.studentCourseDenial.count(),
  ]);
  console.log({
    students, studentsWithBatch, batches, courses,
    studentCourses, packages, packageCourses, studentPackages,
    batchCourses, batchPackages, denials,
  });

  // How many distinct course-sets do the imported students fall into? (Informs
  // whether a one-batch-per-student model can absorb them cleanly.)
  const rows = await prisma.studentCourse.findMany({ select: { studentId: true, courseId: true } });
  const byStudent = new Map<string, string[]>();
  for (const r of rows) {
    const a = byStudent.get(r.studentId) ?? [];
    a.push(r.courseId);
    byStudent.set(r.studentId, a);
  }
  const comboCounts = new Map<string, number>();
  for (const [, cids] of byStudent) {
    const key = cids.sort().join(",");
    comboCounts.set(key, (comboCounts.get(key) ?? 0) + 1);
  }
  console.log(`Students with >=1 direct course: ${byStudent.size}`);
  console.log(`Distinct course-set combinations: ${comboCounts.size}`);
  const dist = [...comboCounts.values()].sort((a, b) => b - a);
  console.log(`Combo sizes (students per combo), top 10: ${dist.slice(0, 10).join(", ")}`);
  console.log(`Combos that are a single student: ${dist.filter((n) => n === 1).length}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
