/**
 * What the worker process needs to claim a job and run a coworker.
 *
 * Built beside the API's own wiring rather than copied into worker/src, so `loadToolsForActor`,
 * `signRun`, and the standing-role path cannot drift. The worker still has no HTTP server: it
 * claims a row and calls `startUnattendedRun`.
 */
import "../compat/eventsource";
import { eq } from "drizzle-orm";
import { COMPUTER_GUIDANCE } from "../../../shared/bot-prompt";
import { mintRunAssertion } from "../agents/callback-token";
import { createAgentProfileStore } from "../agents/profile-store";
import { createRuntimeAgentLoader } from "../agents/runtime-agents";
import { createAuditStore, recordAuditEvent } from "../audit";
import { createChannelStore } from "../channels/routes";
import { createThreadIdentity } from "../channels/thread-identity";
import { createComputerGateway } from "../computer/gateway";
import { isBrowserEnabled } from "../computer/policy";
import {
  createPolicyStore,
  DEFAULT_ACTION_POLICY,
} from "../computer/policy-store";
import { createComputerProvider } from "../computer/provider";
import { createSharedComputerClaimStore } from "../computer/shared-claim";
import { createSnapshotStore } from "../computer/snapshot-store";
import type { DeploymentConfig } from "../config";
import { createUnattendedCopilotRuntime } from "../copilot";
import { createCredentialStore, resolveModelApiKey } from "../credentials";
import { createCrmGateway } from "../crm/gateway";
import { createCrmStore } from "../crm/store";
import { createDatabase, type Database } from "../db/client";
import { runWithRequestRls } from "../db/rls";
import { users } from "../db/schema";
import { createIntelligenceClient } from "../intelligence-client";
import { createKnowledgeSearch } from "../knowledge/search";
import {
  createGoalLoopStore,
  createHighRiskWait,
  orchestratorContextFromLoop,
  recordUnknownOutcomeIfAbsent,
} from "../loop";
import { orgIdOf } from "../orgs/constants";
import { createSpendStore } from "../orgs/spend";
import { createOrganizationStore } from "../orgs/store";
import { createPluginStore } from "../plugins/store";
import { withSpan } from "../telemetry";
import { loadTenantPackage } from "../tenant-package";
import { tavilySearch } from "../web-search/tavily";
import {
  type ActorContext,
  actorContextFromMembership,
  identifyActorFromContext,
} from "./actor";
import { startUnattendedRun } from "./run";
import { startSpecialist } from "./specialist";
import { createJobStore, type JobStore, type UnattendedJob } from "./store";
import {
  createThreadIdleChecker,
  createThreadPersister,
  intelligenceUserForActor,
} from "./thread";
import { createLoadToolsForActor } from "./tools";
import {
  createJobTriggerStore,
  type JobTriggerStore,
  tickDueCrons,
} from "./triggers";

export type UnattendedWorkerRuntime = {
  database: Database;
  jobStore: JobStore;
  triggerStore: JobTriggerStore;
  processJob: (job: UnattendedJob) => Promise<void>;
  tickDueCrons: () => Promise<number>;
};

export async function createUnattendedWorkerRuntime(
  config: DeploymentConfig,
): Promise<UnattendedWorkerRuntime> {
  const database = createDatabase(config.databaseUrl);
  const organizationStore = createOrganizationStore(database);
  const spendStore = createSpendStore(database);
  const credentialStore = createCredentialStore(database);
  const agentVault = {
    store: credentialStore,
    reader: credentialStore,
    encryptionKey: config.keyEncryptionKey,
  };
  const tenantPackage = await loadTenantPackage(config.tenantPackageDirectory);
  const agentProfileStore = createAgentProfileStore(
    database,
    config.managedAgent?.endpoint,
    agentVault,
  );
  const threadIdentity = createThreadIdentity(
    config.deploymentId ?? tenantPackage.tenantId,
  );
  const channelStore = createChannelStore(
    database,
    agentProfileStore,
    threadIdentity,
  );
  const jobStore = createJobStore(database);
  const triggerStore = createJobTriggerStore(database);
  const auditStore = createAuditStore(database);
  const loopStore = createGoalLoopStore(database);
  const policyStore = createPolicyStore(
    config.computer?.policy ?? DEFAULT_ACTION_POLICY,
    database,
  );
  await policyStore.load();
  const highRiskWait = createHighRiskWait({
    loopStore,
    jobStore,
    auditStore,
  });
  const crmStore = createCrmStore(database);
  const crmGateway = createCrmGateway({
    store: crmStore,
    database,
    auditStore,
    policy: (orgId) => policyStore.get(orgId),
    highRiskWait,
  });
  const pluginStore = createPluginStore({
    database,
    auditStore,
    credentials: credentialStore,
    encryptionKey: config.keyEncryptionKey,
    policy: (orgId) => policyStore.get(orgId),
    highRiskWait,
  });
  const knowledgeSearch = createKnowledgeSearch(database);
  const webSearch = config.tavilyApiKey
    ? tavilySearch(config.tavilyApiKey)
    : undefined;
  const computerProvider = config.computer
    ? createComputerProvider(config.computer)
    : undefined;
  const computerGateway = computerProvider
    ? createComputerGateway({
        provider: computerProvider,
        auditStore,
        policy: (orgId) => policyStore.get(orgId),
        snapshots: createSnapshotStore(database),
        allowPrivateHosts: config.computer?.allowPrivateHosts,
        token: config.computer?.token,
        ...(computerProvider.isolation === "shared"
          ? { sharedClaim: createSharedComputerClaimStore(database) }
          : {}),
        highRiskWait,
        assertSpend: async (orgId) => {
          await spendStore.consume({ orgId, kind: "computer" });
        },
      })
    : undefined;
  const loadToolsForActor = createLoadToolsForActor({
    pluginStore,
    knowledgeSearch,
    database,
    auditStore,
    policyFor: (orgId) => policyStore.get(orgId),
    crmGateway,
    publicOrigin: config.auth?.baseUrl,
    jobStore,
    recordActivity: async ({ actor, channelId, activity }) => {
      await channelStore.recordActivity(actor, channelId, activity);
    },
    startSpecialist: (input) =>
      startSpecialist(input, {
        lookupChannel: (actor, channelId) => channelStore.get(actor, channelId),
        addAgents: (actor, channelId, agentIds) =>
          channelStore.addAgents(actor, channelId, agentIds),
        getAgent: (actor, id) => agentProfileStore.get(actor, id),
        listAgents: (actor) => agentProfileStore.list(actor),
        skillBySlug: (slug, orgId) => pluginStore.skillBySlug(slug, orgId),
        jobStore,
        spend: spendStore,
      }),
    ...(webSearch ? { webSearch } : {}),
    ...(computerGateway ? { computerGateway } : {}),
  });
  const loadAgents = createRuntimeAgentLoader(
    database,
    agentVault,
    config.managedAgent,
  );
  const intelligence = createIntelligenceClient(config.runtime.intelligence);
  const threadIdle = createThreadIdleChecker(intelligence);
  const persistThread = createThreadPersister({ intelligence });

  async function actorFromJob(
    job: UnattendedJob,
  ): Promise<ActorContext | null> {
    const membership = await organizationStore.membership(
      job.actingUserId,
      job.orgId,
    );
    if (!membership) return null;
    const [user] = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, job.actingUserId))
      .limit(1);
    if (!user) return null;
    return actorContextFromMembership({
      userId: user.id,
      name: user.name ?? user.email ?? user.id,
      orgId: job.orgId,
      orgRole: membership.role,
    });
  }

  async function processJob(job: UnattendedJob): Promise<void> {
    // Scoped to this job only. A sticky bind left the first org on the
    // process-wide store, so a later queued row in another org was invisible.
    await runWithRequestRls(database, { orgId: job.orgId, bypass: false }, () =>
      withSpan("unattended.job", () => executeJob(job)),
    );
  }

  async function executeJob(job: UnattendedJob): Promise<void> {
    await recordAuditEvent(auditStore, {
      eventType: "job.claimed",
      targetType: "job",
      targetId: job.id,
      actorUserId: job.actingUserId,
      orgId: job.orgId,
      payload: {
        channelId: job.channelId,
        coworkerId: job.coworkerId,
        threadId: job.threadId,
      },
    }).catch(() => undefined);

    const actor = await actorFromJob(job);
    if (!actor) {
      await jobStore.finish(job.id, "failed", {
        error:
          "The acting user is no longer a member of this organization. The job was not started.",
      });
      await recordAuditEvent(auditStore, {
        eventType: "job.refused",
        targetType: "job",
        targetId: job.id,
        actorUserId: job.actingUserId,
        orgId: job.orgId,
        payload: { reason: "acting_user_not_in_org" },
      }).catch(() => undefined);
      return;
    }

    const loop = await loopStore.get(job.orgId, job.channelId);
    const result = await startUnattendedRun({
      actor,
      orgId: job.orgId,
      channelId: job.channelId,
      threadId: job.threadId,
      prompt: job.payload.prompt,
      coworkerId: job.coworkerId,
      goalId: job.goalId,
      skillInstructions: job.payload.skillInstructions,
      deps: {
        lookupMapping: async ({ userId, channelId, orgId }) => {
          const channel = await channelStore.get(
            identifyActorFromContext({
              id: userId,
              role: actor.role,
              orgId,
            }),
            channelId,
          );
          return channel
            ? {
                threadId: channel.threadId,
                channelId: channel.id,
                userId,
              }
            : null;
        },
        threadIdle,
        runtime: createUnattendedCopilotRuntime(
          intelligence,
          config.runtime.intelligence.licenseToken,
          async () => ({
            id: intelligenceUserForActor(actor),
            name: actor.name,
          }),
        ),
        persistThread: persistThread.append,
        recordActivity: async ({
          actor: activityActor,
          channelId,
          activity,
        }) => {
          await channelStore.recordActivity(activityActor, channelId, activity);
        },
        loadAgents,
        loadTools: loadToolsForActor,
        signRun: (actorId, orgId) => (botId, runId) =>
          mintRunAssertion(
            { botId, actorId, runId, orgId: orgIdOf({ orgId }) },
            config.keyEncryptionKey,
          ),
        resolveModelApiKey: () =>
          resolveModelApiKey({
            encryptionKey: config.keyEncryptionKey,
            reader: credentialStore,
            provider: tenantPackage.model.provider,
            keyId: tenantPackage.model.credentialSecretRef,
            environment: process.env,
          }),
        model: tenantPackage.model,
        timeoutMs: config.unattendedJobTimeoutMs,
        threadWaitMs: 15_000,
        computerGuidance:
          config.computer && isBrowserEnabled(policyStore.get(job.orgId))
            ? COMPUTER_GUIDANCE
            : undefined,
        goalLoopGuidance: orchestratorContextFromLoop(loop) || undefined,
        assertSpend: async (orgId) => {
          await spendStore.consume({ orgId, kind: "model" });
        },
      },
    });

    const eventType =
      result.outcome === "succeeded"
        ? "job.succeeded"
        : result.outcome === "refused"
          ? "job.refused"
          : "job.failed";
    await jobStore.finish(
      job.id,
      result.outcome === "succeeded" ? "succeeded" : "failed",
      {
        ...(result.error ? { error: result.error } : {}),
        payload: {
          ...job.payload,
          result: {
            text: result.text,
            persisted: result.persisted,
          },
        },
        crmRecordIds: result.crmRecordIds,
        toolSuccessCount: result.toolSuccessCount,
      },
    );
    await recordAuditEvent(auditStore, {
      eventType,
      targetType: "job",
      targetId: job.id,
      actorUserId: job.actingUserId,
      orgId: job.orgId,
      payload: {
        channelId: job.channelId,
        coworkerId: job.coworkerId,
        threadId: job.threadId,
        ...(result.error ? { error: result.error } : {}),
        intelligenceUser: intelligenceUserForActor(actor),
      },
    }).catch(() => undefined);
    await recordUnknownOutcomeIfAbsent({
      loopStore,
      orgId: job.orgId,
      goalId: job.channelId,
      jobId: job.id,
    });
  }

  return {
    database,
    jobStore,
    triggerStore,
    processJob,
    tickDueCrons: () =>
      tickDueCrons({
        triggerStore,
        jobStore,
        lookupChannel: (actor, channelId) => channelStore.get(actor, channelId),
        auditStore,
        spend: spendStore,
      }),
  };
}
