import { saveUpload } from "@/domain/attachments";
import { getActor } from "@/domain/session";

export const dynamic = "force-dynamic";

// Upload one file (multipart field "file"). Returns the attachment with the AI's reading.
export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Sign in first" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach a file" }, { status: 400 });
  try {
    const view = await saveUpload(actor, { name: file.name, type: file.type, size: file.size, bytes: Buffer.from(await file.arrayBuffer()) });
    return Response.json(view, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
