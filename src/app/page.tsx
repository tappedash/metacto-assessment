import { count } from "drizzle-orm";
import { getAi } from "@/ai";
import { getDb } from "@/db/client";
import { needs, requests, tickets } from "@/db/schema";
import { MatchForm } from "./match-form";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = getDb();
  const ai = getAi();
  const [needRows, [{ requestCount }], [{ ticketCount }]] = await Promise.all([
    db.select({ id: needs.id, title: needs.title, status: needs.status }).from(needs).orderBy(needs.title),
    db.select({ requestCount: count() }).from(requests),
    db.select({ ticketCount: count() }).from(tickets),
  ]);

  return (
    <main>
      <span className="eyebrow">Local MVP skeleton</span>
      <h1>Needs Hub</h1>
      <p className="muted">
        AI provider: <code>{ai.llm.provider}</code> ({ai.llm.model}) · embeddings: <code>{ai.embeddings.model}</code> ·{" "}
        {needRows.length} Customer Needs · {requestCount} Feature Requests · {ticketCount} tickets ·{" "}
        <a href="/api/health">health</a> · <a href="http://localhost:8025">Mailpit</a>
      </p>

      <h2>Try synchronous matching</h2>
      <MatchForm />

      <h2>Customer Needs (seeded)</h2>
      <div className="card">
        <table>
          <thead><tr><th>Customer Need</th><th>Status</th></tr></thead>
          <tbody>
            {needRows.map((n) => (
              <tr key={n.id}><td>{n.title}</td><td>{n.status.replace("_", " ")}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
