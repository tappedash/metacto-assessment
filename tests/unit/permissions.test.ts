import { describe, expect, it } from "vitest";
import { allowedTicketMoves, canSeeContractValue, canViewAccountEvidence, toPublicNeed, type Actor } from "@/domain/permissions";

const pm: Actor = { id: "pm", role: "pm" };
const admin: Actor = { id: "admin", role: "admin" };
const ravi: Actor = { id: "ravi", role: "engineer", staffedAccountIds: ["northwind", "contoso"] };
const lena: Actor = { id: "lena", role: "client", accountId: "northwind" };

describe("evidence visibility", () => {
  it("limits engineers to staffed accounts and clients to their own account", () => {
    expect(canViewAccountEvidence(ravi, "contoso")).toBe(true);
    expect(canViewAccountEvidence(ravi, "fabrikam")).toBe(false);
    expect(canViewAccountEvidence(lena, "northwind")).toBe(true);
    expect(canViewAccountEvidence(lena, "contoso")).toBe(false);
    expect(canViewAccountEvidence(pm, "fabrikam")).toBe(true);
  });

  it("shows contract value to Admin and PM only", () => {
    expect([admin, pm, ravi, lena].map(canSeeContractValue)).toEqual([true, true, false, false]);
  });
});

describe("ticket moves", () => {
  it("lets engineers move only their own tickets through delivery states", () => {
    expect(allowedTicketMoves(ravi, { assigneeId: "ravi", status: "planned" })).toEqual(["in_development"]);
    expect(allowedTicketMoves(ravi, { assigneeId: "ravi", status: "in_development" })).toEqual(["released"]);
    expect(allowedTicketMoves(ravi, { assigneeId: "ravi", status: "backlog" })).toEqual([]); // PM plans
    expect(allowedTicketMoves(ravi, { assigneeId: "mia", status: "planned" })).toEqual([]);
  });

  it("lets the PM move any ticket", () => {
    expect(allowedTicketMoves(pm, { assigneeId: null, status: "backlog" })).toContain("planned");
  });
});

describe("public Need fields", () => {
  it("never exposes rubric, AI brief or priority to clients", () => {
    const pub = toPublicNeed(
      { id: "n", title: "T", problemStatement: "P", status: "planned", publicRationale: "R", priority: "P1", rubricAi: {}, aiBrief: {} },
      52,
    );
    expect(Object.keys(pub).sort()).toEqual(["id", "problemStatement", "publicRationale", "status", "supporterCount", "title"]);
  });
});
