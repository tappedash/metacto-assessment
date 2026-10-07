import nodemailer from "nodemailer";
import { getEnv } from "./env";

// Plain SMTP to Mailpit locally. No outbox or retries in the MVP (see docs/architecture.md).
function transport() {
  const env = getEnv();
  return nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false });
}

export async function verifySmtp(): Promise<void> {
  await transport().verify();
}

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<void> {
  await transport().sendMail({ from: getEnv().MAIL_FROM, ...message });
}
