import { describe, expect, test } from "bun:test";

/**
 * Primary Send must stay the in-tab `onSubmit` → `runAgent` path.
 * Send-and-go is the other control. Live follow-ups that showed the
 * away notice and no reply were unattended jobs, not this button.
 */
describe("composer primary send", () => {
  test("composer-send calls submitDraft / onSubmit, not onSendAndGo", async () => {
    const source = await Bun.file(
      new URL("./composer.tsx", import.meta.url),
    ).text();
    expect(source).toContain('data-testid="composer-send"');
    expect(source).toContain('data-testid="composer-send-and-go"');
    expect(source).toMatch(
      /data-testid="composer-send"[\s\S]*?onClick=\{sendCurrentDraft\}/,
    );
    expect(source).toMatch(
      /data-testid="composer-send-and-go"[\s\S]*?submitAndGo/,
    );
    expect(source).toContain("const sendCurrentDraft = useCallback(() => {");
    expect(source).toContain("void submitDraft(readLiveSegments());");
    expect(source).toContain("await onSubmit(submitted);");
    expect(source).toContain("await onSendAndGo(submitted);");
    expect(source).toContain(
      "Send-and-go is a different path from send: it must not call `onSubmit`",
    );
    const submitDraft = source.slice(
      source.indexOf("const submitDraft = useCallback"),
      source.indexOf("const submitAndGo = useCallback"),
    );
    expect(submitDraft).toContain("await onSubmit(submitted);");
    expect(submitDraft).not.toContain("onSendAndGo");
  });

  test("channel chat primary submit runs the in-tab agent", async () => {
    const source = await Bun.file(
      new URL("../channel-chat.tsx", import.meta.url),
    ).text();
    expect(source).toContain("await copilotkit.runAgent({ agent });");
    expect(source).toContain("await say(draft.text, skillInstructions);");
    const onSubmit = source.slice(
      source.indexOf("onSubmit={async (draft) => {"),
      source.indexOf("onStop={() => {"),
    );
    expect(onSubmit).toContain("await say(draft.text, skillInstructions);");
    expect(onSubmit).not.toContain("enqueueJob");
    expect(onSubmit).not.toContain("onSendAndGo");
    const onSendAndGo = source.slice(
      source.indexOf("onSendAndGo={async (draft) => {"),
      source.indexOf("onSubmit={async (draft) => {"),
    );
    expect(onSendAndGo).toContain("enqueueJob.mutateAsync");
    expect(onSendAndGo).not.toContain("runAgent");
  });
});
