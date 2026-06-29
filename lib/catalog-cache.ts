import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";

/**
 * Cached lookups for low-write, high-read reference data used as filter and
 * picker options across admin pages. Cached briefly with explicit tags so
 * mutations can invalidate (`revalidateTag`) without us needing to think
 * about every page that consumes them.
 *
 * Don't cache anything tied to a specific user/session here.
 */

export const CATALOG_TAGS = {
  batches: "catalog:batches",
  courses: "catalog:courses",
  auditFacets: "catalog:audit-facets",
} as const;

export const getActiveBatches = unstable_cache(
  () =>
    prisma.batch.findMany({
      orderBy: { batchCode: "asc" },
      select: { id: true, batchCode: true, batchName: true },
    }),
  ["catalog:batches:v1"],
  { tags: [CATALOG_TAGS.batches], revalidate: 300 },
);

export const getActiveCourses = unstable_cache(
  () =>
    prisma.course.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ["catalog:courses:v1"],
  { tags: [CATALOG_TAGS.courses], revalidate: 300 },
);

export const getAuditFacets = unstable_cache(
  async () => {
    const [actions, entities] = await Promise.all([
      prisma.auditLog.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
        take: 200,
      }),
      prisma.auditLog.findMany({
        distinct: ["entityType"],
        select: { entityType: true },
        where: { entityType: { not: null } },
        take: 100,
      }),
    ]);
    return { actions, entities };
  },
  ["catalog:audit-facets:v1"],
  { tags: [CATALOG_TAGS.auditFacets], revalidate: 60 },
);
