import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { composioKeys } from "./queries";

function invalidateCatalog(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: composioKeys.all });
}

export type ConnectComposioInput = {
  slug: string;
  callbackUrl: string;
};

export type ConnectComposioResult = {
  redirectUrl: string | null;
  alreadyConnected: boolean;
};

export function connectComposioMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (
      input: ConnectComposioInput,
    ): Promise<ConnectComposioResult> => {
      const response = await client("/api/composio/connect", {
        method: "POST",
        body: input,
        fallback: "That plugin could not be connected.",
      });
      return response.json();
    },
    onSuccess: () => invalidateCatalog(queryClient),
  });
}

export function disconnectComposioMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (connectionId: string) => {
      await client(
        `/api/composio/connections/${encodeURIComponent(connectionId)}`,
        {
          method: "DELETE",
          fallback: "That plugin could not be disconnected.",
        },
      );
    },
    onSuccess: () => invalidateCatalog(queryClient),
  });
}
