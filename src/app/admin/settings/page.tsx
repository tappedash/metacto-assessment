import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { requireActor } from "@/domain/session";
import { CUSTOMER_NOTIFY_KEYS, getSettings, type CustomerNotifyKey } from "@/domain/settings";
import { saveSettingsAction } from "../actions";

export const dynamic = "force-dynamic";

const NOTIFY_LABEL: Record<CustomerNotifyKey, string> = {
  planned: "A ticket is Planned",
  in_development: "A ticket moves to In Development",
  ready_for_review: "A ticket is Ready for Review",
  released: "A ticket is Released",
  rework_decision: "Their rework request is accepted or declined",
};

// A few workspace defaults. No configurable prompts or automation rules.
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireActor(["admin"]);
  const sp = await searchParams;
  const settings = await getSettings();
  return (
    <>
      <PageHead eyebrow="Settings" title="Workspace defaults" lede="Kept deliberately small. AI suggests; people decide." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <form action={saveSettingsAction} className="stack">
        <section className="card">
          <h2 style={{ fontSize: "1.05rem" }}>AI matching</h2>
          <label className="field" style={{ marginTop: ".6rem" }}>Match confidence threshold (%)
            <input type="number" name="matchThreshold" min={30} max={95} step={5} defaultValue={Math.round(settings.matchThreshold * 100)} style={{ width: "8rem" }} />
          </label>
          <p className="muted">Matches below this confidence aren&apos;t suggested to the customer; their request goes to PM Triage. Customers can always reject a suggested match (&quot;No, mine is different&quot;) or correct what AI understood before matching.</p>
        </section>
        <section className="card">
          <h2 style={{ fontSize: "1.05rem" }}>Customer notifications</h2>
          <p className="muted" style={{ margin: ".3rem 0 .6rem" }}>Customers following a Need hear about these delivery events in Needs Hub and by email:</p>
          {CUSTOMER_NOTIFY_KEYS.map((k) => (
            <label className="check" key={k}><input type="checkbox" name={`notify_${k}`} defaultChecked={settings.customerNotify[k]} /> {NOTIFY_LABEL[k]}</label>
          ))}
        </section>
        <section className="card">
          <h2 style={{ fontSize: "1.05rem" }}>Defaults for new users</h2>
          <p className="muted" style={{ margin: ".3rem 0 .6rem" }}>Applied at first sign-in; each person can change theirs. Assignments and rework requests always reach the in-app inbox.</p>
          <label className="check"><input type="checkbox" name="defaultNotifyInApp" defaultChecked={settings.defaultNotifyInApp} /> In-app notifications</label>
          <label className="check"><input type="checkbox" name="defaultNotifyEmail" defaultChecked={settings.defaultNotifyEmail} /> Email notifications</label>
        </section>
        <div><button className="btn btn-primary" type="submit">Save settings</button></div>
      </form>
    </>
  );
}
