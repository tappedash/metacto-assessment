import { PageHead } from "@/components/ui";
import { ShareFlow } from "@/components/share-flow";
import { feedbackTargets } from "@/domain/delivery";
import { requireActor } from "@/domain/session";

export const dynamic = "force-dynamic";

export default async function LogFeedbackPage() {
  const actor = await requireActor(["engineer"]);
  const targets = await feedbackTargets(actor);
  return (
    <div className="narrow">
      <PageHead eyebrow="Log client feedback" title="Capture the client's problem, not the fix"
        lede="Logged on behalf of the client: it counts toward the client's demand, not yours. It never creates a delivery ticket." />
      {targets.length ? <ShareFlow mode="engineer" targets={targets} /> : <div className="card empty"><h2>No staffed clients</h2><p className="muted">Ask your Workspace Admin to staff you on a client first.</p></div>}
    </div>
  );
}
