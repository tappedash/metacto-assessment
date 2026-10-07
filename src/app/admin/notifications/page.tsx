import { NotificationInbox } from "@/components/notification-inbox";
import type { SearchParams } from "@/components/ui";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  return <NotificationInbox actor={await requireActor(["admin"])} searchParams={searchParams} />;
}
