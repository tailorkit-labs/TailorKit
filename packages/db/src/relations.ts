import { defineRelations, defineRelationsPart } from "drizzle-orm";
import { authRelations } from "./schema/auth";
import * as schema from "./schema";

const applicationRelations = defineRelations(schema, (r) => ({
  project: {
    organization: r.one.organization({
      from: r.project.organizationId,
      to: r.organization.id,
    }),
    apps: r.many.app({
      from: r.project.id,
      to: r.app.projectId,
    }),
    cliAuthSessions: r.many.cliAuthSession({
      from: r.project.id,
      to: r.cliAuthSession.projectId,
    }),
    cliTokens: r.many.cliToken({
      from: r.project.id,
      to: r.cliToken.projectId,
    }),
    agentSessions: r.many.agentSession({
      from: r.project.id,
      to: r.agentSession.projectId,
    }),
    previewSessions: r.many.previewSession({
      from: r.project.id,
      to: r.previewSession.projectId,
    }),
  },

  cliAuthSession: {
    project: r.one.project({
      from: r.cliAuthSession.projectId,
      to: r.project.id,
    }),
  },

  cliToken: {
    project: r.one.project({
      from: r.cliToken.projectId,
      to: r.project.id,
    }),
    previewSessions: r.many.previewSession({
      from: r.cliToken.id,
      to: r.previewSession.cliTokenId,
    }),
  },

  agentSession: {
    project: r.one.project({
      from: r.agentSession.projectId,
      to: r.project.id,
    }),
  },

  previewSession: {
    app: r.one.app({ from: r.previewSession.appId, to: r.app.id }),
    cliToken: r.one.cliToken({ from: r.previewSession.cliTokenId, to: r.cliToken.id }),
    project: r.one.project({ from: r.previewSession.projectId, to: r.project.id }),
  },

  app: {
    project: r.one.project({
      from: r.app.projectId,
      to: r.project.id,
    }),
    currentDeployment: r.one.appDeployment({
      from: r.app.currentDeploymentId,
      to: r.appDeployment.id,
    }),
    deployments: r.many.appDeployment({
      from: r.app.id,
      to: r.appDeployment.appId,
    }),
    previewSessions: r.many.previewSession({
      from: r.app.id,
      to: r.previewSession.appId,
    }),
  },

  appDeployment: {
    app: r.one.app({
      from: r.appDeployment.appId,
      to: r.app.id,
    }),
    files: r.many.appDeploymentFile({
      from: r.appDeployment.id,
      to: r.appDeploymentFile.appDeploymentId,
    }),
  },

  appDeploymentFile: {
    appDeployment: r.one.appDeployment({
      from: r.appDeploymentFile.appDeploymentId,
      to: r.appDeployment.id,
    }),
  },
}));

const organizationProjectRelations = defineRelationsPart(schema, (r) => ({
  organization: {
    ...authRelations.organization.relations,
    projects: r.many.project({
      from: r.organization.id,
      to: r.project.organizationId,
    }),
  },
}));

export const relations = {
  ...applicationRelations,
  ...authRelations,
  ...organizationProjectRelations,
};
