import { Notice, PageHead, param, type SearchParams } from "@/components/ui";
import { listGoals } from "@/domain/admin";
import { deleteGoalAction, saveGoalAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const goals = await listGoals();
  return (
    <div className="narrow">
      <PageHead eyebrow="Strategic goals" title={'What "strategic" means this year'}
        lede="Set 3-5 goals. AI explains each Customer Need's fit against them, so Strategic Value stays independent from popularity." />
      <Notice notice={param(sp.notice)} error={param(sp.error)} />
      <div className="card flush list">
        {goals.map((g) => (
          <div className="item" key={g.id}>
            <form action={saveGoalAction.bind(null, g.id)} className="btn-row">
              <span className="eyebrow" style={{ margin: 0 }}>{g.code}</span>
              <label className="sr-only" htmlFor={`goal-${g.id}`}>Goal {g.code}</label>
              <input id={`goal-${g.id}`} type="text" name="text" defaultValue={g.text} style={{ margin: 0, flex: 1, minWidth: 220 }} />
              <button className="btn btn-ghost btn-sm" type="submit">Save</button>
              <button className="btn btn-ghost btn-sm" formAction={deleteGoalAction.bind(null, g.id)} type="submit">Remove</button>
            </form>
          </div>
        ))}
        {goals.length < 5 && (
          <div className="item">
            <form action={saveGoalAction.bind(null, null)} className="btn-row">
              <label className="sr-only" htmlFor="goal-new">New goal</label>
              <input id="goal-new" type="text" name="text" placeholder="Add a strategic goal" required style={{ margin: 0, flex: 1, minWidth: 220 }} />
              <button className="btn btn-primary btn-sm" type="submit">Add goal</button>
              <span className="muted">{goals.length} of 5 used</span>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
