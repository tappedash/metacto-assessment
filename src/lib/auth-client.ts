"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin client: talks to /api/auth on whatever host serves the app.
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
