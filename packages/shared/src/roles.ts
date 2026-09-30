export const serviceRoles = ["api", "collab", "worker"] as const;

export type ServiceRole = (typeof serviceRoles)[number];

export function isServiceRole(value: string): value is ServiceRole {
  return (serviceRoles as readonly string[]).includes(value);
}
