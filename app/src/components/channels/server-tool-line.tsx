import { Streamdown } from "streamdown";
import { ToolLine } from "@/components/channels/tool-line";
import { markdownComponents } from "@/lib/markdown";
import { readToolName } from "@/lib/plugins/tool-name";
import { asText, forDisplay, REFUSAL_MARKER } from "@/lib/plugins/tool-result";

/**
 * A tool the runtime executed, drawn for the person watching.
 *
 * Named from the reader's side: what was done, against which server, with the server's own words
 * behind a disclosure. The identifier the model was offered never reaches the screen.
 */
export function ServerToolLine({
  name,
  result,
  hint,
}: {
  name: string;
  result?: string;
  /** Extra context from the call itself, such as the search query. Wins over the MCP server name. */
  hint?: string;
}) {
  const { label, detail } = readToolName(name);
  /*
   * A refusal is not a result, and must not read like one.
   *
   * The server says which it is rather than the browser inferring it from the wording, because the
   * wording is a policy message an administrator can rewrite and the first rephrasing would break
   * any guess made here. See REFUSAL_MARKER in server/src/plugins/tools.ts.
   */
  const answer = result === undefined ? undefined : asText(result);
  const refused = answer?.startsWith(REFUSAL_MARKER) ?? false;
  /*
   * The marker is for this component, not for the reader. Left in, a refusal reads "Blocked" in the
   * label and then "Refused." again in the first two words of the body, which is the same fact three
   * times over by the end of the sentence. Stripped here rather than on the server, because the
   * server's copy is what the model is told and "Refused." in front of a reason is right for it.
   */
  const body = refused ? answer?.slice(REFUSAL_MARKER.length).trim() : answer;
  return (
    <ToolLine
      {...(hint || detail ? { detail: hint ?? detail } : {})}
      label={label}
      refused={refused}
      running={result === undefined}
    >
      {body ? (
        <Streamdown components={markdownComponents}>
          {forDisplay(body)}
        </Streamdown>
      ) : null}
    </ToolLine>
  );
}
