// Display labels shared by every role's UI.
export const NEED_STATUS: Record<string, { label: string; chip: string }> = {
  under_review: { label: "Under Review", chip: "st-review" },
  planned: { label: "Planned", chip: "st-planned" },
  in_development: { label: "In Development", chip: "st-dev" },
  released: { label: "Released", chip: "st-released" },
  not_planned: { label: "Not Planned", chip: "st-notplanned" },
};

export const TICKET_STATUS: Record<string, { label: string; chip: string }> = {
  backlog: { label: "Backlog", chip: "st-review" },
  planned: { label: "Planned", chip: "st-planned" },
  in_development: { label: "In Development", chip: "st-dev" },
  released: { label: "Released", chip: "st-released" },
};

export const TICKET_ORDER = ["backlog", "planned", "in_development", "released"] as const;

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
