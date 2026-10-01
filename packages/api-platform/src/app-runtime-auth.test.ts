import { expect, it, vi } from "vite-plus/test";
import { APP_RUNTIME_AUDIENCE, storageTokenVerifier } from "@tailorkit/app-storage/auth";
const settings = vi.hoisted(() => ({
  APP_RUNTIME_SIGNING_KEY: "",
  APP_RUNTIME_PREVIOUS_PUBLIC_KEYS: undefined as string | undefined,
  OPENAPI_SERVER_URL: "https://platform.test/api/platform",
}));
vi.mock("./env", () => ({ env: settings }));
import {
  appRuntimePublicKeys,
  issueAppRuntimeToken,
  appRuntimeKeysResponse,
} from "./app-runtime-auth";
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
settings.APP_RUNTIME_SIGNING_KEY = JSON.stringify({
  ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
  kid: "platform",
});

it("publishes only public keys and issues platform-bound short-lived access", async () => {
  const publicKeys = appRuntimePublicKeys();
  expect(publicKeys.keys[0]).not.toHaveProperty("d");
  const identity = {
    userId: "user",
    projectId: "project",
    appId: "app",
    installationId: "installation",
    deploymentId: "deployment",
  };
  const session = await issueAppRuntimeToken(identity);
  const verify = storageTokenVerifier({
    issuer: settings.OPENAPI_SERVER_URL,
    audience: APP_RUNTIME_AUDIENCE,
    requireDeployment: true,
    publicKeys,
  });
  expect(await verify(session.token)).toMatchObject(identity);
  expect(session.expiresAt - Date.now()).toBeLessThanOrEqual(120_000);
  expect(appRuntimeKeysResponse().status).toBe(200);
});

it("refuses to expose private material in retired keys", () => {
  settings.APP_RUNTIME_PREVIOUS_PUBLIC_KEYS = JSON.stringify({
    keys: [JSON.parse(settings.APP_RUNTIME_SIGNING_KEY)],
  });
  expect(() => appRuntimePublicKeys()).toThrow("public ES256");
  expect(appRuntimeKeysResponse().status).toBe(503);
  settings.APP_RUNTIME_PREVIOUS_PUBLIC_KEYS = undefined;
});
