import { z } from "zod";

/**
 * Canonical PII schema used across all broker adapters.
 *
 * Design rule: adapters request ONLY the fields a given broker's opt-out flow
 * actually requires (see BrokerAdapter.requiredFields). Never pass the full
 * profile to a broker that only needs a subset — see THREAT_MODEL.md
 * "Compromised/malicious data broker" mitigation.
 */
export const PiiProfileSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().optional(),
  dateOfBirth: z.string().optional(), // ISO 8601 date
  emails: z.array(z.string().email()).default([]),
  phones: z.array(z.string()).default([]),
  addresses: z
    .array(
      z.object({
        street: z.string(),
        city: z.string(),
        state: z.string(),
        zip: z.string(),
        country: z.string().default("US"),
      }),
    )
    .default([]),
  relatives: z.array(z.string()).default([]),
});

export type PiiProfile = z.infer<typeof PiiProfileSchema>;

export type PiiField = keyof PiiProfile;

/** Returns a copy of the profile containing only the requested fields. */
export function pickPiiFields(
  profile: PiiProfile,
  fields: readonly PiiField[],
): Partial<PiiProfile> {
  const picked: Partial<PiiProfile> = {};
  for (const field of fields) {
    if (profile[field] !== undefined) {
      (picked as Record<string, unknown>)[field] = profile[field];
    }
  }
  return picked;
}
