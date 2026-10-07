import { PageHead } from "@/components/ui";
import { StaffingToggle } from "@/components/staffing-toggle";
import { staffingMatrix } from "@/domain/admin";

export const dynamic = "force-dynamic";

export default async function StaffingPage() {
  const { engineers, accounts, isStaffed } = await staffingMatrix();
  return (
    <>
      <PageHead eyebrow="Staffing" title="Who works on which engagement"
        lede="Staffing decides what each engineer can see: client names and evidence only for their engagements. Changes save automatically." />
      <div className="card flush">
        <table className="stack-sm">
          <thead><tr><th scope="col">Engineer</th>{accounts.map((a) => <th scope="col" key={a.id}>{a.name}</th>)}</tr></thead>
          <tbody>
            {engineers.map((e) => (
              <tr key={e.id}>
                <td className="primary"><b>{e.name}</b></td>
                {accounts.map((a) => (
                  <td key={a.id} data-label={a.name} className="chk-cell">
                    <StaffingToggle engineerId={e.id} accountId={a.id} label={`${e.name} on ${a.name}`} initial={isStaffed(e.id, a.id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
