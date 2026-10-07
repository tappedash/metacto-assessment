"use client";

import { useFormStatus } from "react-dom";

/** Submit button for server-action forms: disabled with a pending label while the action runs (AI or email can take seconds). */
export function SubmitButton({ children, pending, className = "btn btn-primary", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { pending: string }) {
  const status = useFormStatus();
  return (
    <button {...rest} className={className} type="submit" disabled={status.pending || rest.disabled} aria-busy={status.pending}>
      {status.pending ? pending : children}
    </button>
  );
}
