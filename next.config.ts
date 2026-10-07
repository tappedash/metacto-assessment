import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo also holds static prototypes, specs and diagrams; only src/ is the app.
  serverExternalPackages: ["postgres", "nodemailer"],
};

export default nextConfig;
