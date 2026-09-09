import { z } from "zod";

/**
 * Types for the persistent, multi-person household PII store.
 *
 * DESIGN NOTE — physical isolation over application-level ACLs (per project
 * decision 2026-09-09): each unrelated top-level "household" gets its own
 * separate encrypted store instance (own file, own BWS secret) rather than
 * one shared database with row-level access control. A deployment serving
 * several unrelated people just constructs multiple PeopleStore instances
 * pointed at different backing files/secrets. This means there is no shared
 * storage layer where an access-control bug could leak one household's PII
 * into another's — isolation is structural, not logical.
 */

const uuidSchema = z.string().uuid();

export const PersonRecordSchema = z.object({
  id: uuidSchema,
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
  /**
   * Free-text notes about this person, e.g. "Ex-spouse, do not contact" —
   * never sent to any broker, local reference only.
   */
  notes: z.string().optional(),
});

export type PersonRecord = z.infer<typeof PersonRecordSchema>;

/**
 * Typed relationship edge between two people in the SAME household store.
 * Deliberately does not support a free-text fallback: a relative you don't
 * want a full PersonRecord for should not be represented here at all (add
 * them as a minimal PersonRecord with just a name if you want them tracked,
 * or omit — see docs/PEOPLE_STORE.md for the rationale).
 */
export const RELATIONSHIP_TYPES = ["spouse", "parent", "child", "sibling", "other"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const RelationshipEdgeSchema = z
  .object({
    personA: uuidSchema,
    personB: uuidSchema,
    type: z.enum(RELATIONSHIP_TYPES),
  })
  .refine((edge) => edge.personA !== edge.personB, {
    message: "personA and personB must be different people (no self-relationships)",
  });

export type RelationshipEdge = z.infer<typeof RelationshipEdgeSchema>;

export const HouseholdSchema = z
  .object({
    people: z.array(PersonRecordSchema).default([]),
    relationships: z.array(RelationshipEdgeSchema).default([]),
  })
  .superRefine((household, ctx) => {
    const seenIds = new Set<string>();
    for (const person of household.people) {
      if (seenIds.has(person.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate person id in household: ${person.id}`,
        });
      }
      seenIds.add(person.id);
    }

    for (const edge of household.relationships) {
      if (!seenIds.has(edge.personA)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Relationship references unknown personA id: ${edge.personA}`,
        });
      }
      if (!seenIds.has(edge.personB)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Relationship references unknown personB id: ${edge.personB}`,
        });
      }
    }
  });

export type Household = z.infer<typeof HouseholdSchema>;
