"use client";

import { useState, useTransition } from "react";
import { setStaffingAction } from "@/app/admin/actions";

// Autosaving checkbox: one click staffs or unstaffs an engineer.
export function StaffingToggle({ engineerId, accountId, label, initial }: { engineerId: string; accountId: string; label: string; initial: boolean }) {
  const [checked, setChecked] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <input type="checkbox" aria-label={label} checked={checked} disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setChecked(next);
          start(async () => setMessage(`${label}: ${await setStaffingAction(engineerId, accountId, next)}`));
        }} />
      <span className="sr-only" role="status" aria-live="polite">{message}</span>
    </>
  );
}
