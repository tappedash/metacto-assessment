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

describe("ticket moves over a project's configurable statuses", () => {
  // A custom workflow: names are free, stages drive the rules.
  const flow = [
    { id: "backlog", stage: "backlog" as const }, { id: "planned", stage: "planned" as const },
    { id: "build", stage: "in_progress" as const }, { id: "uat", stage: "in_progress" as const }, { id: "live", stage: "done" as const },
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("lets engineers move their own tickets between any non-Backlog statuses", () => {
    expect(ids(allowedTicketMoves(ravi, { assigneeId: "ravi", statusId: "planned", stage: "planned" }, flow))).toEqual(["build", "uat", "live"]);
    expect(ids(allowedTicketMoves(ravi, { assigneeId: "ravi", statusId: "uat", stage: "in_progress" }, flow))).toEqual(["planned", "build", "live"]);
  });

  it("keeps Backlog a PM decision and other people's tickets off limits", () => {
    expect(allowedTicketMoves(ravi, { assigneeId: "ravi", statusId: "backlog", stage: "backlog" }, flow)).toEqual([]);
    expect(allowedTicketMoves(ravi, { assigneeId: "mia", statusId: "build", stage: "in_progress" }, flow)).toEqual([]);
  });

  it("lets the PM move any ticket to any status", () => {
    expect(ids(allowedTicketMoves(pm, { assigneeId: null, statusId: "backlog", stage: "backlog" }, flow))).toEqual(["planned", "build", "uat", "live"]);
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
