import { redirect } from "next/navigation";

/** Runs a mutation and redirects back with ?notice= or ?error= (redirect must stay outside try). */
export async function withFlash(path: string, run: () => Promise<string | void>): Promise<never> {
  let target: string;
  const sep = path.includes("?") ? "&" : "?";
  try {
    const notice = await run();
    target = notice ? `${path}${sep}notice=${encodeURIComponent(notice)}` : path;
  } catch (error) {
    target = `${path}${sep}error=${encodeURIComponent((error as Error).message)}`;
  }
  redirect(target);
}

export const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
