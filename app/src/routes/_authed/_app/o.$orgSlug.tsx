import { createFileRoute, redirect } from "@tanstack/react-router";
import { client } from "@/lib/client";
import { orgKeys } from "@/lib/orgs/queries";

export const Route = createFileRoute("/_authed/_app/o/$orgSlug")({
  beforeLoad: async ({ context, params }) => {
    await client("/api/orgs/current", {
      method: "POST",
      body: { slug: params.orgSlug },
      fallback: "Could not switch organization",
    });
    await context.queryClient.invalidateQueries({ queryKey: orgKeys.all });
    throw redirect({ to: "/" });
  },
});
