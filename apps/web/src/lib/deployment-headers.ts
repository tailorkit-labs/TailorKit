export const deploymentHeaders =
  import.meta.env.VITE_VERCEL_SKEW_PROTECTION_ENABLED && import.meta.env.VITE_VERCEL_DEPLOYMENT_ID
    ? { "x-deployment-id": import.meta.env.VITE_VERCEL_DEPLOYMENT_ID }
    : {};
