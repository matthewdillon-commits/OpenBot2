/**
 * One search against Tavily, and nothing else.
 *
 * Tavily is the vendor because it is built for this job: a Bot that needs the public web without
 * opening a browser. The response is titles, addresses and short passages, which is what a model
 * can cite. A general search index would hand back ten blue links and send the Bot to the computer
 * to read them, which is the thing this tool exists so it does not have to do.
 *
 * The key travels in the Authorization header, never in the query and never in a body field a log
 * would print next to the question. A caller that put the key in the URL would leak it into every
 * proxy log between here and Tavily.
 */

export type WebHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearch = {
  search: (query: string) => Promise<WebHit[]>;
};

const TAVILY_SEARCH = "https://api.tavily.com/search";
const MAX_RESULTS = 5;

export function tavilySearch(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): WebSearch {
  return {
    search: async (query) => {
      const response = await fetchImpl(TAVILY_SEARCH, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: MAX_RESULTS,
          include_answer: false,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          detail.trim()
            ? `Tavily refused the search (${response.status}): ${detail.trim()}`
            : `Tavily refused the search (${response.status}).`,
        );
      }

      const body = (await response.json()) as {
        results?: Array<{
          title?: unknown;
          url?: unknown;
          content?: unknown;
        }>;
      };

      return (body.results ?? [])
        .map((row) => ({
          title: typeof row.title === "string" ? row.title.trim() : "",
          url: typeof row.url === "string" ? row.url.trim() : "",
          snippet: typeof row.content === "string" ? row.content.trim() : "",
        }))
        .filter((hit) => hit.url.length > 0);
    },
  };
}
