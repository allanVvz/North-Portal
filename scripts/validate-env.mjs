import { getSupabaseProjectRef, loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();

const mode = process.argv[2] ?? "app";
const requirements = {
  app: [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ],
  cloud: [],
};

if (!requirements[mode]) {
  console.error(`Unknown validation mode: ${mode}`);
  process.exit(2);
}

try {
  const values = requirements[mode].length ? requireEnv(requirements[mode]) : {};

  if (mode === "app") {
    const url = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an https://*.supabase.co URL.");
    }
    if (values.NEXT_PUBLIC_SUPABASE_ANON_KEY === values.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("The public and service-role keys must be different.");
    }
  } else {
    getSupabaseProjectRef();
  }

  console.log(`Environment validation passed (${mode}); required values present.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
