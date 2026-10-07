import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getDb } from "@/db/client";
import { authAccounts, authSessions, authVerifications, users } from "@/db/schema";
import { applyInvitation, canSignIn, markInvitationAccepted, NotInvitedError } from "@/domain/invitations";
import { getEnv, googleConfigured } from "./env";
import { sendEmail } from "./mailer";

// Better Auth handles identity (Google OAuth, magic links, sessions in Postgres).
// Authorization stays in the app: roles and client accounts live on `users`, are set only
// from invitations, and every page and server action checks them (src/domain/session.ts).

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { users, authSessions, authAccounts, authVerifications },
    }),
    user: {
      modelName: "users",
      additionalFields: {
        // Server-owned: never accepted from a sign-in/sign-up request.
        role: { type: "string", required: false, input: false },
        accountId: { type: "string", required: false, input: false },
      },
    },
    session: { modelName: "authSessions" },
    account: {
      modelName: "authAccounts",
      // Signing in with Google links to the existing user with the same (verified) email.
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    verification: { modelName: "authVerifications" },
    advanced: { database: { generateId: "uuid" } },
    socialProviders: googleConfigured(env)
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
      : {},
    databaseHooks: {
      user: {
        create: {
          // Invitation-only sign-up: role and client account come from the invitation.
          before: async (user) => {
            try {
              return { data: await applyInvitation(user) };
            } catch (error) {
              if (error instanceof NotInvitedError) throw new APIError("FORBIDDEN", { message: error.message, code: "NOT_INVITED" });
              throw error;
            }
          },
          after: async (user) => markInvitationAccepted(user.email),
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        sendMagicLink: async ({ email, url }) => {
          // Only send to people who can sign in; respond the same either way (no account probing).
          if (!(await canSignIn(email))) return;
          await sendEmail({
            to: email,
            subject: "Your Needs Hub sign-in link",
            text: `Sign in to Needs Hub:\n\n${url}\n\nThis link expires in 10 minutes. If you didn't ask for it, ignore this email.`,
          });
        },
      }),
      nextCookies(), // must stay last: lets server actions set the session cookie
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __needsHubAuth?: Auth };

/** Created on first use so builds and scripts don't need auth configuration. */
export function getAuth(): Auth {
  globalForAuth.__needsHubAuth ??= createAuth();
  return globalForAuth.__needsHubAuth;
}
