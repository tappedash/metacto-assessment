import { PageHead } from "@/components/ui";
import { ShareFlow } from "@/components/share-flow";

export default function SharePage() {
  return (
    <div className="narrow">
      <PageHead eyebrow="Share feedback" title="What's slowing you down?"
        lede="Describe it in your own words. If others raised the same problem, your support adds weight instead of starting from zero." />
      <ShareFlow mode="client" />
    </div>
  );
}
