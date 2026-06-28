import "./env";

/**
 * Active tenant for the demo UI. In a real deployment this comes from the
 * authenticated session; here it's the seeded synthetic tenant. Every query is
 * still RLS-scoped to this value via withTenant().
 */
export const DEMO_TENANT =
  process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
