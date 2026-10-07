import { z } from "zod/v4";

/** Validate and parse data against a Zod schema, returning typed result */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

/** Validate data, returning { success, data?, error? } instead of throwing */
export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// Common reusable schemas
export const emailSchema = z.string().email();
export const uuidSchema = z.string().uuid();
export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const positiveIntSchema = z.number().int().positive();
