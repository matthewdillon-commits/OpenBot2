import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

export type ComposioPlugin = {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  categories: string[];
  noAuth: boolean;
  connected: boolean;
  connectionId: string | null;
};

export type ComposioCatalog = {
  configured: boolean;
  plugins: ComposioPlugin[];
};

export const composioKeys = {
  all: ["composio"] as const,
  catalog: () => ["composio", "catalog"] as const,
};

export function composioCatalogQueryOptions() {
  return queryOptions({
    queryKey: composioKeys.catalog(),
    queryFn: async (): Promise<ComposioCatalog> => {
      const response = await client("/api/composio/catalog", {
        fallback: "The plugin catalogue could not be loaded.",
      });
      return response.json();
    },
  });
}
