import { PageHead, param, type SearchParams } from "@/components/ui";
import { ClientShareFlow } from "@/components/client-share-flow";
import { ownedAttachments, toView } from "@/domain/attachments";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

export default async function SharePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor(["client"]);
  // The Assistant can hand over a file the customer shared with it (?attachment=<id>).
  const attachmentId = param((await searchParams).attachment);
  const initial = /^[0-9a-f-]{36}$/.test(attachmentId) ? (await ownedAttachments(actor, [attachmentId], { unlinkedOnly: true })).map(toView) : [];
  return (
    <div className="narrow">
      <PageHead eyebrow="Share feedback" title="What's slowing you down?"
        lede="Describe it in your own words, attach files, or both. AI reads everything together, checks what you mean, and finds whether others raised the same problem." />
      <ClientShareFlow initialAttachments={initial} />
    </div>
  );
}
