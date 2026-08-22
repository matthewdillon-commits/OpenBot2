export type ConnectorStatus = {
  id: string;
  type: "google_drive" | "onedrive";
  name: string;
  roots: string[];
  configured: boolean;
};

export type ConnectorAdminService = {
  list: (orgId?: string) => Promise<ConnectorStatus[]>;
  configureGoogleDrive?: (input: {
    serviceAccountJson: string;
    impersonationSubject: string;
    actorUserId: string;
    orgId?: string;
  }) => Promise<ConnectorStatus>;
};

type KnowledgeSource = {
  type: "google-drive" | "microsoft-onedrive";
  roots: string[];
};

export function createConnectorCatalogService(
  sources: KnowledgeSource[],
): ConnectorAdminService {
  return {
    list: async () =>
      sources.map((source) =>
        source.type === "google-drive"
          ? {
              id: "google-drive",
              type: "google_drive",
              name: "Google Drive",
              roots: source.roots,
              configured: false,
            }
          : {
              id: "microsoft-onedrive",
              type: "onedrive",
              name: "Microsoft OneDrive",
              roots: source.roots,
              configured: false,
            },
      ),
  };
}

export function createConnectorAdminService(
  sources: KnowledgeSource[],
  database: Database,
  credentials: CredentialAdminService,
): ConnectorAdminService {
  const catalog = createConnectorCatalogService(sources);
  return {
    /**
     * The catalogue, with each entry told whether this deployment has configured it.
     *
     * `knowledge.yaml` says what a deployment may connect to rather than what it has, so whether a
     * connector is configured is read from the instances table instead.
     */
    list: async (orgId = LOCAL_ORGANIZATION_ID) => {
      const configured = new Set(
        (
          await database
            .select({ type: connectorInstances.type })
            .from(connectorInstances)
            .where(eq(connectorInstances.orgId, orgId))
        ).map((row) => row.type),
      );
      return (await catalog.list()).map((connector) => ({
        ...connector,
        configured: configured.has(connector.type),
      }));
    },
    configureGoogleDrive: async (input) => {
      const source = sources.find((item) => item.type === "google-drive");
      if (!source)
        throw new Error("Google Drive is not enabled by knowledge.yaml");
      const orgId = input.orgId ?? LOCAL_ORGANIZATION_ID;
      const credential = await credentials.create({
        kind: "connector",
        provider: "google_drive",
        keyId: input.impersonationSubject,
        metadata: {},
        plaintext: input.serviceAccountJson,
        actorUserId: input.actorUserId,
        orgId,
      });
      const sourceMetadata = {
        roots: source.roots,
        impersonationSubject: input.impersonationSubject,
      };
      const [existing] = await database
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(
          and(
            eq(connectorInstances.type, "google_drive"),
            eq(connectorInstances.orgId, orgId),
          ),
        );
      if (existing) {
        await database
          .update(connectorInstances)
          .set({
            credentialId: credential.id,
            sourceMetadata,
            updatedAt: new Date(),
          })
          .where(eq(connectorInstances.id, existing.id));
      } else {
        await database.insert(connectorInstances).values({
          orgId,
          type: "google_drive",
          credentialId: credential.id,
          sourceMetadata,
        });
      }
      return {
        id: "google-drive",
        type: "google_drive",
        name: "Google Drive",
        roots: source.roots,
        configured: true,
      };
    },
  };
}

import { and, eq } from "drizzle-orm";
import type { CredentialAdminService } from "./credentials";
import type { Database } from "./db/client";
import { connectorInstances } from "./db/schema";
import { LOCAL_ORGANIZATION_ID } from "./orgs/constants";
