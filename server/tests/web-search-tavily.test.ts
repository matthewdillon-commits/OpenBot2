import { describe, expect, test } from "bun:test";
import { tavilySearch } from "../src/web-search/tavily";

describe("the Tavily client", () => {
  test("posts the query with the key in the Authorization header", async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = [];
    const search = tavilySearch("tvly-secret", async (url, init) => {
      seen.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({
        results: [
          {
            title: "Example Domain",
            url: "https://example.com/",
            content: "This domain is for use in documentation examples.",
          },
          { title: "", url: "", content: "dropped: no address" },
        ],
      });
    });

    await expect(search.search("example domain")).resolves.toEqual([
      {
        title: "Example Domain",
        url: "https://example.com/",
        snippet: "This domain is for use in documentation examples.",
      },
    ]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.tavily.com/search");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tvly-secret");
    expect(seen[0]?.body).toEqual({
      query: "example domain",
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
    });
    // The key stays out of the body so a logged request does not print it next to the question.
    expect(JSON.stringify(seen[0]?.body)).not.toContain("tvly-secret");
  });

  test("turns a failed status into a sentence the model can say", async () => {
    const search = tavilySearch("tvly-secret", async () => {
      return new Response("quota exceeded", { status: 429 });
    });

    await expect(search.search("anything")).rejects.toThrow(/429/);
    await expect(search.search("anything")).rejects.toThrow(/quota exceeded/);
  });
});
