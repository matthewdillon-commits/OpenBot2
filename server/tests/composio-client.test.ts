import { describe, expect, test } from "bun:test";
import { composioClient } from "../src/composio/client";

describe("the Composio client", () => {
  test("lists toolkits by usage and connections by organisation id", async () => {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const client = composioClient("ak_secret", async (url, init) => {
      const parsed = String(init?.body ?? "");
      seen.push({
        url: String(url),
        method: String(init?.method ?? "GET"),
        body: parsed ? JSON.parse(parsed) : null,
      });
      const path = String(url);
      if (path.includes("/toolkits")) {
        return Response.json({
          items: [
            {
              slug: "gmail",
              name: "Gmail",
              meta: {
                description: "Mail",
                logo: "https://logo.test/gmail.png",
              },
              categories: [{ name: "Featured" }],
            },
            { slug: "notion", name: "Notion", categories: ["Productivity"] },
          ],
        });
      }
      if (path.includes("/connected_accounts?")) {
        return Response.json({
          items: [
            {
              id: "ca_gmail",
              status: "ACTIVE",
              user_id: "org_acme",
              toolkit: { slug: "gmail" },
            },
          ],
        });
      }
      return new Response("not used", { status: 500 });
    });

    const catalog = await client.catalog("org_acme");
    expect(catalog.configured).toBe(true);
    expect(catalog.plugins.map((plugin) => plugin.slug)).toEqual([
      "gmail",
      "notion",
    ]);
    expect(catalog.plugins[0]?.connected).toBe(true);
    expect(catalog.plugins[1]?.connected).toBe(false);

    const toolkitUrl = seen.find((entry) =>
      entry.url.includes("/toolkits"),
    )?.url;
    expect(toolkitUrl).toContain("sort_by=usage");
    expect(
      seen.find((entry) => entry.url.includes("/connected_accounts"))?.url,
    ).toContain("user_ids=org_acme");
    expect(JSON.stringify(seen)).not.toContain("ak_secret");
  });

  test("starts a connection as the organisation, not a shared Composio user", async () => {
    const seen: { url: string; body: unknown; headers: Headers }[] = [];
    const client = composioClient("ak_secret", async (url, init) => {
      const headers = new Headers(init?.headers);
      const parsed = String(init?.body ?? "");
      seen.push({
        url: String(url),
        body: parsed ? JSON.parse(parsed) : null,
        headers,
      });
      const path = String(url);
      if (path.includes("/connected_accounts?") && !path.includes("/link")) {
        return Response.json({ items: [] });
      }
      if (path.includes("/auth_configs?") && init?.method !== "POST") {
        return Response.json({ items: [] });
      }
      if (path.endsWith("/auth_configs") && init?.method === "POST") {
        return Response.json({ id: "ac_gmail" }, { status: 200 });
      }
      if (path.endsWith("/connected_accounts/link")) {
        return Response.json({
          redirect_url: "https://connect.composio.dev/link/abc",
        });
      }
      return new Response("unused", { status: 500 });
    });

    const result = await client.connect(
      "org_acme",
      "gmail",
      "http://localhost:3010/plugins",
    );
    expect(result.alreadyConnected).toBe(false);
    expect(result.redirectUrl).toBe("https://connect.composio.dev/link/abc");
    const link = seen.find((entry) =>
      entry.url.endsWith("/connected_accounts/link"),
    );
    expect(link?.body).toEqual({
      user_id: "org_acme",
      auth_config_id: "ac_gmail",
      callback_url: "http://localhost:3010/plugins",
    });
    expect(link?.headers.get("x-api-key")).toBe("ak_secret");
    expect(JSON.stringify(link?.body)).not.toContain("ak_secret");
  });
});
