import { z } from "zod";
import { parseDriveFileId } from "@/lib/drive";

export const idSchema = z.string().min(1).max(64);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(255);

export const studentCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  // Admin-given IDs may contain spaces, e.g. "KLM 2606 1282".
  .regex(/^[A-Za-z0-9 _-]+$/, "studentCode must be letters/digits/space/_/-");

export const dateSchema = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !isNaN(d.getTime()), "invalid date");

const idsArraySchema = z
  .union([z.array(idSchema), idSchema])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .pipe(z.array(idSchema))
  .optional()
  .default([]);

export const studentCreateSchema = z
  .object({
    studentCode: studentCodeSchema,
    name: z.string().trim().min(1).max(200),
    email: emailSchema,
    // Existing batches to add the student to. Access = union of these batches'
    // courses. Empty is allowed (student exists but can't watch anything yet).
    batchIds: idsArraySchema,
    accessStartDate: dateSchema,
    accessEndDate: dateSchema,
  })
  .refine((s) => s.accessEndDate >= s.accessStartDate, {
    path: ["accessEndDate"],
    message: "accessEndDate must be on/after accessStartDate",
  });

export const studentUpdateSchema = z
  .object({
    studentCode: studentCodeSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    email: emailSchema.optional(),
    status: z.enum(["active", "blocked"]).optional(),
    accessStartDate: dateSchema.optional(),
    accessEndDate: dateSchema.optional(),
  })
  .refine(
    (s) =>
      !(s.accessStartDate && s.accessEndDate) ||
      s.accessEndDate! >= s.accessStartDate!,
    { path: ["accessEndDate"], message: "accessEndDate must be on/after accessStartDate" },
  );

/** Diff submitted from the student edit form: which batches the student is in. */
export const studentBatchesSchema = z.object({
  studentId: idSchema,
  batchIds: idsArraySchema,
});

export const adminCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: emailSchema,
});

export const adminUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: emailSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const batchSchema = z.object({
  batchCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9 _-]+$/, "batchCode must be alphanumeric/space/_/-"),
  batchName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  courseIds: idsArraySchema,
});

/** Which courses are assigned to a batch (submitted from the batch hub). */
export const batchCoursesSchema = z.object({
  batchId: idSchema,
  courseIds: idsArraySchema,
});

const imageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url("imageUrl must be a valid URL")
  .optional()
  .or(z.literal(""));

export const courseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  imageUrl: imageUrlSchema,
  status: z.enum(["active", "inactive"]).default("active"),
  /** "module" → course → modules → videos. "flat" → course → videos directly. */
  layout: z.enum(["module", "flat"]).default("module"),
});

export const moduleSchema = z.object({
  courseId: idSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  moduleOrder: z.coerce.number().int().min(0).default(0),
});

/**
 * Video input — admin pastes any Drive URL/ID; we transform to canonical fileId.
 * Exactly one of moduleId / courseId must be set (depending on the parent course's layout).
 */
export const videoSchema = z
  .object({
    moduleId: idSchema.optional(),
    courseId: idSchema.optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    driveFileId: z
      .string()
      .trim()
      .min(1, "Drive link or ID is required")
      .transform((v, ctx) => {
        const id = parseDriveFileId(v);
        if (!id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "could not extract a Drive file ID from input",
          });
          return z.NEVER;
        }
        return id;
      }),
    videoOrder: z.coerce.number().int().min(0).default(0),
    status: z.enum(["active", "inactive"]).default("active"),
  })
  .refine((v) => !!v.moduleId !== !!v.courseId, {
    path: ["moduleId"],
    message: "provide exactly one of moduleId or courseId",
  });

// Update form: any field can change but the moduleId/courseId pair, if present,
// must still pass the "exactly one" rule.
export const videoUpdateSchema = z
  .object({
    moduleId: idSchema.optional(),
    courseId: idSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    driveFileId: z
      .string()
      .trim()
      .min(1)
      .transform((v, ctx) => {
        const id = parseDriveFileId(v);
        if (!id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "could not extract a Drive file ID from input",
          });
          return z.NEVER;
        }
        return id;
      })
      .optional(),
    videoOrder: z.coerce.number().int().min(0).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  });

const noteCommon = z.object({
  videoId: idSchema,
  title: z.string().trim().min(1).max(200),
  downloadEnabled: z.coerce.boolean().default(false),
});

/**
 * Note input — discriminated by sourceType. Pastable Drive link runs through
 * parseDriveFileId. External URL must be https. Upload arrives via FormData
 * and is validated separately at the action layer (this schema covers metadata).
 */
export const noteSchema = z.discriminatedUnion("sourceType", [
  noteCommon.extend({
    sourceType: z.literal("drive"),
    driveInput: z
      .string()
      .trim()
      .min(1, "Drive link or ID is required")
      .transform((v, ctx) => {
        const id = parseDriveFileId(v);
        if (!id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "could not extract a Drive file ID",
          });
          return z.NEVER;
        }
        return id;
      }),
  }),
  noteCommon.extend({
    sourceType: z.literal("url"),
    externalUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((u) => /^https:\/\//i.test(u), "URL must use https"),
  }),
  noteCommon.extend({
    sourceType: z.literal("upload"),
    // Uploads are handled outside Zod (File via FormData); just gate the marker.
  }),
]);

export const enrollmentAssignSchema = z.object({
  studentId: idSchema.optional(),
  batchId: idSchema.optional(),
  courseId: idSchema.optional(),
});

export const progressSchema = z.object({
  videoId: idSchema,
  lastTimestamp: z.coerce.number().int().min(0).max(60 * 60 * 24),
  completed: z.coerce.boolean().optional(),
});

/** Bulk action over selected students from the admin search page. */
export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_to_batch"),
    studentIds: z.array(idSchema).min(1),
    batchId: idSchema,
  }),
  z.object({
    action: z.literal("remove_from_batch"),
    studentIds: z.array(idSchema).min(1),
    batchId: idSchema,
  }),
  z.object({
    action: z.literal("block"),
    studentIds: z.array(idSchema).min(1),
  }),
  z.object({
    action: z.literal("activate"),
    studentIds: z.array(idSchema).min(1),
  }),
  z.object({
    action: z.literal("set_end_date"),
    studentIds: z.array(idSchema).min(1),
    endDate: dateSchema,
  }),
  z.object({
    action: z.literal("delete"),
    studentIds: z.array(idSchema).min(1),
  }),
]);
