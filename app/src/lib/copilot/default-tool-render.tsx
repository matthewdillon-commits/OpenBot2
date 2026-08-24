import { useDefaultRenderTool } from "@copilotkit/react-core/v2";
import { ServerToolLine } from "@/components/channels/server-tool-line";
import { toolHintFrom } from "@/lib/plugins/tool-name";

/**
 * How a server tool looks in the transcript when nobody registered a dedicated renderer.
 *
 * CopilotKit's built-in fallback is a card named after the function (`search_web`) whose styles
 * live under `data-copilotkit`. This chat is not that surface, so the card arrived as a tiny
 * chevron and a raw identifier — easy to miss, and easy to read as the Bot having done nothing.
 * Name it as an action, shimmer while it runs, and put the query beside it when there is one.
 */
export function DefaultToolRender() {
  useDefaultRenderTool({
    render: ({ name, status, parameters, result }) => (
      <ServerToolLine
        hint={toolHintFrom(parameters)}
        name={name}
        result={status === "complete" ? result : undefined}
      />
    ),
  });
  return null;
}
