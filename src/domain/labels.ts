// Display labels shared by every role's UI.
export const NEED_STATUS: Record<string, { label: string; chip: string }> = {
  under_review: { label: "Under Review", chip: "st-review" },
  planned: { label: "Planned", chip: "st-planned" },
  in_development: { label: "In Development", chip: "st-dev" },
  released: { label: "Released", chip: "st-released" },
  not_planned: { label: "Not Planned", chip: "st-notplanned" },
};

// Ticket statuses are configured per project; their chip colour/shape follows the stage.
export const STAGE_CHIP: Record<string, string> = {
  backlog: "st-review",
  planned: "st-planned",
  in_progress: "st-dev",
  done: "st-released",
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "Workspace Admin",
  pm: "Product Manager",
  engineer: "Engineer",
  client: "Client",
};

export const ROLE_HOME: Record<string, string> = {
  admin: "/admin/clients",
  pm: "/pm/triage",
  engineer: "/engineer/work",
  client: "/client/share",
};
