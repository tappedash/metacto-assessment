import { readAttachment, removeAttachment } from "@/domain/attachments";
import { getActor } from "@/domain/session";

export const dynamic = "force-dynamic";

// Open an attachment (owner, PM, or engineer staffed on the request's account).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Sign in first", { status: 401 });
  const file = await readAttachment(actor, (await params).id).catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.row.mimeType,
      "content-disposition": `${file.row.kind === "image" || file.row.kind === "pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.row.filename)}`,
      "x-content-type-options": "nosniff",
      // Customer files never run as pages on our origin.
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    },
  });
}

// Remove an attachment that hasn't been submitted yet (owner only).
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    await removeAttachment(actor, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
