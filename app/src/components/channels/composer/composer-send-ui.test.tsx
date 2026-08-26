import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Composer } from "./composer";

afterEach(() => {
  cleanup();
});

describe("composer primary submit", () => {
  test("the Send button calls onSubmit (runAgent), not onSendAndGo", async () => {
    const submitted: string[] = [];
    const sentAndGo: string[] = [];
    const view = render(
      <Composer
        compact
        onSendAndGo={(draft) => {
          sentAndGo.push(draft.text);
        }}
        onSubmit={(draft) => {
          submitted.push(draft.text);
        }}
      />,
    );

    const field = view.getByLabelText("Message");
    fireEvent.input(field, { target: { innerText: "Lookup LimitlessAI" } });
    field.textContent = "Lookup LimitlessAI";
    fireEvent.input(field, { target: { textContent: "Lookup LimitlessAI" } });

    fireEvent.click(view.getByTestId("composer-send"));

    await waitFor(() => {
      expect(submitted).toEqual(["Lookup LimitlessAI"]);
    });
    expect(sentAndGo).toEqual([]);
  });

  test("send-and-go is the other control", async () => {
    const submitted: string[] = [];
    const sentAndGo: string[] = [];
    const view = render(
      <Composer
        compact
        onSendAndGo={(draft) => {
          sentAndGo.push(draft.text);
        }}
        onSubmit={(draft) => {
          submitted.push(draft.text);
        }}
      />,
    );

    const field = view.getByLabelText("Message");
    field.textContent = "Hello";
    fireEvent.input(field, { target: { textContent: "Hello" } });
    fireEvent.click(view.getByTestId("composer-send-and-go"));

    await waitFor(() => {
      expect(sentAndGo).toEqual(["Hello"]);
    });
    expect(submitted).toEqual([]);
  });
});
