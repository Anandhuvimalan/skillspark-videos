import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Root Admin";

function days(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log("[seed] starting");

  const admin = await prisma.admin.upsert({
    where: { email: ADMIN_EMAIL },
    create: { name: ADMIN_NAME, email: ADMIN_EMAIL },
    update: { name: ADMIN_NAME },
  });
  console.log("[seed] admin:", admin.email);

  // Default student-email template (admin-editable in the composer).
  await prisma.emailTemplate.upsert({
    where: { key: "default" },
    update: {},
    create: {
      key: "default",
      subject: "Access your SkillSpark courses",
      body: `Hi {{name}},

Your SkillSpark learning account is ready.

How to access your content:
1. Go to {{platformUrl}}
2. Click "Sign in with Google" and use THIS email address ({{email}}).
3. Your assigned courses appear on your dashboard.

If you can't sign in, reply to this email and we'll help.

— SkillSpark Academic Coordinator`,
    },
  });
  console.log("[seed] email template: default");

  // Courses
  const courseNames = [
    "Excel",
    "GST",
    "VAT",
    "Accounting",
    "SQL",
    "Python",
    "Power BI Desktop",
    "Power BI Service",
  ];
  const courses = new Map<string, string>();
  for (const name of courseNames) {
    const c = await prisma.course.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    courses.set(name, c.id);
  }

  // Batches (the only access path) + their assigned courses.
  async function upsertBatch(batchCode: string, batchName: string, courseNamesForBatch: string[]) {
    const b = await prisma.batch.upsert({
      where: { batchCode },
      create: { batchCode, batchName },
      update: { batchName },
    });
    for (const n of courseNamesForBatch) {
      await prisma.batchCourse.upsert({
        where: { batchId_courseId: { batchId: b.id, courseId: courses.get(n)! } },
        create: { batchId: b.id, courseId: courses.get(n)! },
        update: {},
      });
    }
    return b;
  }

  const batchData = await upsertBatch("ONLB101", "Online Batch 101 (Data Analytics)", [
    "Excel", "SQL", "Python", "Power BI Desktop", "Power BI Service",
  ]);
  const batchAccounting = await upsertBatch("ONLB102", "Online Batch 102 (Accounting)", [
    "GST", "VAT", "Accounting", "Excel",
  ]);
  const batchEmpty = await upsertBatch("ONLB103", "Online Batch 103 (no courses yet)", []);

  // Sample students, each in zero or more batches.
  const studentSpecs: Array<{
    studentCode: string;
    name: string;
    email: string;
    batchIds: string[];
  }> = [
    { studentCode: "S100", name: "Adira (accounting batch)", email: "adira@example.com", batchIds: [batchAccounting.id] },
    { studentCode: "S101", name: "Eli (data analytics)", email: "eli@example.com", batchIds: [batchData.id] },
    { studentCode: "S102", name: "Pavi (both batches)", email: "pavi@example.com", batchIds: [batchData.id, batchAccounting.id] },
    { studentCode: "S103", name: "Bina (data analytics)", email: "bina@example.com", batchIds: [batchData.id] },
    { studentCode: "S104", name: "Cy (empty batch, no access)", email: "cy@example.com", batchIds: [batchEmpty.id] },
  ];

  for (const spec of studentSpecs) {
    const s = await prisma.student.upsert({
      where: { email: spec.email },
      create: {
        studentCode: spec.studentCode,
        name: spec.name,
        email: spec.email,
        accessStartDate: days(-7),
        accessEndDate: days(365),
      },
      update: {
        name: spec.name,
        accessStartDate: days(-7),
        accessEndDate: days(365),
      },
    });
    for (const batchId of spec.batchIds) {
      await prisma.studentBatch.upsert({
        where: { studentId_batchId: { studentId: s.id, batchId } },
        create: { studentId: s.id, batchId },
        update: {},
      });
    }
  }

  // Sample modules + videos for Excel
  const excelId = courses.get("Excel")!;
  const intro = await prisma.module.upsert({
    where: { id: "seed-mod-excel-intro" },
    create: {
      id: "seed-mod-excel-intro",
      courseId: excelId,
      title: "Excel — Intro",
      moduleOrder: 0,
    },
    update: { title: "Excel — Intro", moduleOrder: 0 },
  });
  const formulas = await prisma.module.upsert({
    where: { id: "seed-mod-excel-formulas" },
    create: {
      id: "seed-mod-excel-formulas",
      courseId: excelId,
      title: "Excel — Formulas",
      moduleOrder: 1,
    },
    update: { title: "Excel — Formulas", moduleOrder: 1 },
  });

  // Two sample videos with placeholder Drive file IDs.
  // duration is left null — auto-filled by Drive API on next save when the key is set.
  const v1 = await prisma.video.upsert({
    where: { id: "seed-vid-excel-1" },
    create: {
      id: "seed-vid-excel-1",
      moduleId: intro.id,
      title: "What is Excel?",
      videoOrder: 0,
      driveFileId: "1A2B3C4D5E6F7G8H9I0J",
    },
    update: {},
  });
  await prisma.video.upsert({
    where: { id: "seed-vid-excel-2" },
    create: {
      id: "seed-vid-excel-2",
      moduleId: formulas.id,
      title: "VLOOKUP basics",
      videoOrder: 0,
      driveFileId: "0K1L2M3N4O5P6Q7R8S9T",
    },
    update: {},
  });

  // Sample note — external URL form (download disabled by default).
  await prisma.note.upsert({
    where: { id: "seed-note-1" },
    create: {
      id: "seed-note-1",
      videoId: v1.id,
      title: "Intro slides (PDF)",
      sourceType: "url",
      externalUrl: "https://example.com/files/excel-intro.pdf",
      downloadEnabled: false,
    },
    update: {},
  });

  console.log("[seed] done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
