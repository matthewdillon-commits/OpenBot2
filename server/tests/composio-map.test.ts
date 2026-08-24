import { describe, expect, test } from "bun:test";
import {
  attachConnections,
  FEATURED_COUNT,
  groupCatalog,
  parseConnection,
  parseToolkit,
} from "../src/composio/map";

function must<T>(value: T | null, label: string): T {
  expect(value).not.toBeNull();
  if (value === null) throw new Error(`${label} was missing`);
  return value;
}

describe("the Composio catalogue mapper", () => {
  test("keeps Composio's usage order so the most popular toolkit stays first", () => {
    const gmail = must(
      parseToolkit({
        slug: "gmail",
        name: "Gmail",
        description: "Mail",
        logo: "https://logo.test/gmail.png",
        meta: { categories: [{ name: "Featured" }] },
      }),
      "gmail toolkit",
    );
    const obscure = must(
      parseToolkit({
        slug: "obscure",
        name: "Obscure",
        categories: ["Research"],
      }),
      "obscure toolkit",
    );
    expect(gmail.slug).toBe("gmail");
    const plugins = attachConnections([gmail, obscure], []);
    expect(plugins.map((plugin) => plugin.slug)).toEqual(["gmail", "obscure"]);
    const grouped = groupCatalog(plugins);
    expect(grouped.featured[0]?.slug).toBe("gmail");
    expect(grouped.featured).toHaveLength(Math.min(2, FEATURED_COUNT));
    expect(grouped.sections[0]?.name).toBe("Featured");
    expect(grouped.sections[1]?.name).toBe("Research");
  });

  test("marks a toolkit connected only from this organisation's active grant", () => {
    const toolkit = must(
      parseToolkit({ slug: "slack", name: "Slack" }),
      "slack toolkit",
    );
    const connection = must(
      parseConnection({
        id: "ca_1",
        status: "ACTIVE",
        user_id: "org_acme",
        toolkit: { slug: "slack" },
      }),
      "slack connection",
    );
    expect(connection).toEqual({
      id: "ca_1",
      slug: "slack",
      status: "ACTIVE",
      userId: "org_acme",
    });
    const plugins = attachConnections([toolkit], [connection]);
    expect(plugins[0]?.connected).toBe(true);
    expect(plugins[0]?.connectionId).toBe("ca_1");
  });
});
