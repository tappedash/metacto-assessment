import { describe, expect, it } from "vitest";
import { boardColumns } from "@/components/board-columns";
import { DEFAULT_WORKFLOW, sortStatuses, validateWorkflow, type StatusDef } from "@/domain/workflow";

describe("validateWorkflow", () => {
  it("accepts the default and custom flows", () => {
    expect(validateWorkflow(DEFAULT_WORKFLOW)).toBeNull();
    expect(validateWorkflow([
      { name: "Backlog", stage: "backlog" }, { name: "Build", stage: "in_progress" },
      { name: "Security review", stage: "in_progress" }, { name: "UAT", stage: "in_progress" }, { name: "Live", stage: "done" },
    ])).toBeNull();
  });

  it("rejects flows the product rules can't work with", () => {
    expect(validateWorkflow([{ name: "Doing", stage: "in_progress" }, { name: "Done", stage: "done" }])).toMatch(/Backlog/);
    expect(validateWorkflow([{ name: "Backlog", stage: "backlog" }, { name: "Doing", stage: "in_progress" }])).toMatch(/Done/);
    expect(validateWorkflow([{ name: "Backlog", stage: "backlog" }, { name: "backlog", stage: "planned" }, { name: "Done", stage: "done" }])).toMatch(/unique/);
    expect(validateWorkflow([{ name: "Backlog", stage: "backlog" }, { name: "Done", stage: "done" }, { name: "QA", stage: "in_progress" }])).toMatch(/order/);
    expect(validateWorkflow([{ name: " ", stage: "backlog" }, { name: "Done", stage: "done" }])).toMatch(/name/);
  });
});

describe("board columns", () => {
  const flow: StatusDef[] = sortStatuses([
    { id: "s4", projectId: "p", name: "Live", stage: "done", publicStatus: null, position: 3 },
    { id: "s1", projectId: "p", name: "Backlog", stage: "backlog", publicStatus: null, position: 0 },
    { id: "s3", projectId: "p", name: "UAT", stage: "in_progress", publicStatus: null, position: 2 },
    { id: "s2", projectId: "p", name: "Build", stage: "in_progress", publicStatus: null, position: 1 },
  ]);
  const tickets = [
    { id: "a", projectId: "p", statusId: "s2", stage: "in_progress" as const },
    { id: "b", projectId: "p", statusId: "s3", stage: "in_progress" as const },
    { id: "c", projectId: "q", statusId: "x", stage: "done" as const },
  ];

  it("uses a single project's own statuses as columns, in order", () => {
    expect(boardColumns(tickets, flow).map((c) => `${c.title}:${c.cards.length}`)).toEqual(["Backlog:0", "Build:1", "UAT:1", "Live:0"]);
  });

  it("groups several projects by stage", () => {
    expect(boardColumns(tickets, null).map((c) => `${c.title}:${c.cards.length}`)).toEqual(["Backlog:0", "Planned:0", "In progress:2", "Done:1"]);
  });
});
