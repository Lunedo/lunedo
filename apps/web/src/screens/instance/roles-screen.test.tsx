import { describe, expect, it } from "vitest";
import type { InstanceAccount } from "../../api/instance-queries.js";
import { withOwner } from "./roles-screen.js";

const owner = {
  id: "0b6f1c1e-6f7b-4f53-9d7b-3c1f2f0c9a10",
  instanceRoles: [{ builtInRole: "owner", customRoleId: null, name: null }],
} as unknown as InstanceAccount;
const auditor = {
  id: "4d2c8a7e-1b2f-4c3d-8e9f-0a1b2c3d4e5f",
  instanceRoles: [{ builtInRole: "securityAuditor", customRoleId: null, name: null }],
} as unknown as InstanceAccount;
const assignment = {
  id: "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a",
  scope: "instance" as const,
  organizationId: null,
  role: "securityAuditor",
  builtInRole: "securityAuditor" as const,
  customRoleId: null,
  principalKind: "account" as const,
  principalId: auditor.id,
  expiresAt: null,
};

describe("instance role assignments", () => {
  it("lists the instance owner, who holds the role without an assignment", () => {
    const rows = withOwner([assignment], [auditor, owner]);
    expect(rows.map((row) => [row.builtInRole, row.principalId])).toEqual([
      ["owner", owner.id],
      ["securityAuditor", auditor.id],
    ]);
  });

  it("does not list the owner twice", () => {
    const ownerAssignment = {
      ...assignment,
      id: "owner-row",
      builtInRole: "owner" as const,
      principalId: owner.id,
    };
    expect(withOwner([ownerAssignment], [owner])).toHaveLength(1);
  });
});
