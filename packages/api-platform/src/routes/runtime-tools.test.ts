import { expect, it, vi } from "vite-plus/test";
import { appTokenVerifier, APP_TOOL_AUDIENCE } from "@tailorkit/api-utils/app-auth";
const state = vi.hoisted(() => ({ key: "", app: undefined as unknown }));
vi.mock("../env", () => ({
  env: {
    get APP_RUNTIME_SIGNING_KEY() {
      return state.key;
    },
    OPENAPI_SERVER_URL: "https://platform.test/api/platform",
  },
}));
vi.mock("@tailorkit/db", () => ({ db: { query: { app: { findFirst: async () => state.app } } } }));
import { appRuntimePublicKeys, issueAppRuntimeToken } from "../runtime/auth";
import { handleToolCredentialRequest } from "./runtime";
import { canonicalizeScope } from "../scope";
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
state.key = JSON.stringify({
  ...(await crypto.subtle.exportKey("jwk", pair.privateKey)),
  kid: "platform",
});
const identity = {
  subjectId: "job:billing",
  installationId: "app",
  appId: "app",
  appPublicId: "public-app",
  projectId: "project",
  deploymentId: "deployment",
  publicTeamId: "team",
  scope: { name: "org", value: { id: "tenant" } },
  toolUrl: "https://product.test/api/tailorkit/tools/execute",
};
async function exchange(body: unknown, overrides = {}) {
  const session = await issueAppRuntimeToken({ ...identity, ...overrides });
  return handleToolCredentialRequest(
    new Request("https://platform.test/api/platform/runtime/tools", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
it("derives a short-lived tool credential from verified runtime identity and active installation", async () => {
  state.app = {
    id: "app",
    ...canonicalizeScope(identity.scope),
    currentDeployment: { id: "deployment" },
  };
  const response = await exchange({ path: "billing.read" });
  expect(response?.status).toBe(200);
  const value = await response!.json();
  expect(value.url).toBe(identity.toolUrl);
  expect(value.identity).toMatchObject(identity);
  const verify = appTokenVerifier({
    issuer: "https://platform.test/api/platform",
    audience: APP_TOOL_AUDIENCE,
    purpose: "tool",
    toolPath: "billing.read",
    publicKeys: appRuntimePublicKeys(),
  });
  expect(await verify(value.token)).toMatchObject(identity);
  expect((await exchange({ path: "billing.read", subjectId: "victim" }))?.status).toBe(401);
  expect(
    (await exchange({ path: "billing.read" }, { scope: { name: "org", value: { id: "other" } } }))
      ?.status,
  ).toBe(401);
  state.app = {
    id: "app",
    ...canonicalizeScope(identity.scope),
    currentDeployment: { id: "replacement" },
  };
  expect((await exchange({ path: "billing.read" }))?.status).toBe(401);
});
