/** Values baked in at build time (validated by scripts/build.ts before Vite runs). */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL as string,
  webAppUrl: import.meta.env.VITE_WEB_APP_URL as string,
  environment: import.meta.env.VITE_ENVIRONMENT as "development" | "staging" | "production",
  policyPublicKey: import.meta.env.VITE_POLICY_PUBLIC_KEY as string,
};
