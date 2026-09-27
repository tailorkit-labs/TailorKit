import { getBaseUrl } from "@tailorkit/env";
import { env } from "#env";

interface AppDeploymentAssets {
  clientEntryFileId: string | null;
  logoDarkPath?: string | null;
  logoLightPath?: string | null;
  publicId: string;
  status: string;
}

export function withAppAssetUrl<
  T extends {
    currentDeployment: AppDeploymentAssets | null;
    publicId: string;
  },
>(app: T, publicTeamId: string, projectId: string) {
  const deployment = app.currentDeployment;
  const nodeBaseUrl =
    env.ASSET_BASE_URL ??
    (env.NODE_ENV === "development" ? `${getBaseUrl(env)}/api/assets` : undefined);
  const assetBaseUrl = nodeBaseUrl
    ? `${nodeBaseUrl.replace(/\/$/u, "")}/t/${publicTeamId}`
    : `https://${publicTeamId}.${env.ASSET_DOMAIN}`;
  let clientPath: string | undefined;
  let logoPaths: { dark?: string; light?: string } | undefined;

  if (deployment?.status === "published" && deployment.clientEntryFileId) {
    const appBase = `${assetBaseUrl}/p/${projectId}/a/${app.publicId}`;
    const deploymentBase = `${appBase}/d/${deployment.publicId}`;
    clientPath = `${deploymentBase}/client.js`;
    const getLogoUrl = (path: string) =>
      path.startsWith("logos/") ? `${appBase}/${path}` : `${deploymentBase}/${path}`;
    const logos = {
      ...(deployment.logoDarkPath ? { dark: getLogoUrl(deployment.logoDarkPath) } : {}),
      ...(deployment.logoLightPath ? { light: getLogoUrl(deployment.logoLightPath) } : {}),
    };

    if (Object.keys(logos).length > 0) {
      logoPaths = logos;
    }
  }

  return { ...app, clientPath, logoPaths };
}
