// Placeholder until rework requests land (part B of this change).
import type { SessionActor } from "@/domain/session";
export async function ReworkReview(_: { ticketId: string; actor: SessionActor; back: string }) {
  return null;
}
