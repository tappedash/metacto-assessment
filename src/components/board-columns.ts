import { STAGES, STAGE_LABEL, type Stage, type StatusDef } from "@/domain/workflow";

interface BoardTicket {
  projectId: string;
  statusId: string;
  stage: Stage;
}

export interface Column<T> {
  key: string;
  title: string;
  stage: Stage;
  cards: T[];
}

/**
 * One project: that project's own statuses as columns.
 * Several projects: the four fixed stages as columns (each card shows its own status name).
 */
export function boardColumns<T extends BoardTicket>(tickets: T[], workflow: StatusDef[] | null): Column<T>[] {
  if (workflow) {
    return workflow.map((s) => ({ key: s.id, title: s.name, stage: s.stage, cards: tickets.filter((t) => t.statusId === s.id) }));
  }
  return STAGES.map((stage) => ({ key: stage, title: STAGE_LABEL[stage], stage, cards: tickets.filter((t) => t.stage === stage) }));
}
