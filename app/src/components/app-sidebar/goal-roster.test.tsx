import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { GoalRoster } from "./goal-roster";

afterEach(() => {
  cleanup();
});

function renderRoster(
  overrides: Partial<ComponentProps<typeof GoalRoster>> = {},
) {
  return render(
    <GoalRoster
      channels={[]}
      isPending={false}
      onSearchChange={() => {}}
      onStatusChange={() => {}}
      query=""
      search=""
      status="all"
      {...overrides}
    />,
  );
}

describe("goal roster empty states", () => {
  test("no goals yet is not a search miss", () => {
    const view = renderRoster({ channels: [], query: "", search: "" });
    expect(view.getByText(/don't have goals yet/)).toBeTruthy();
    expect(view.queryByText(/No goals match your search/)).toBeNull();
  });

  test("a search miss quotes the query and does not say the roster is empty", () => {
    const view = renderRoster({
      channels: [],
      query: "Zebra",
      search: "  Zebra  ",
    });
    expect(view.getByText(/No goals match your search/)).toBeTruthy();
    expect(view.getByText(/Zebra/)).toBeTruthy();
    expect(view.queryByText(/don't have goals yet/)).toBeNull();
  });

  test("an Active or Completed miss is not 'no goals yet' and not a search miss", () => {
    const active = renderRoster({
      channels: [],
      query: "",
      status: "active",
    });
    expect(active.getByText("No active goals.")).toBeTruthy();
    expect(active.queryByText(/don't have goals yet/)).toBeNull();
    expect(active.queryByText(/No goals match your search/)).toBeNull();
    cleanup();
    const completed = renderRoster({
      channels: [],
      query: "",
      status: "completed",
    });
    expect(completed.getByText("No completed goals.")).toBeTruthy();
  });

  test("pending and placeholder data do not show a false empty", () => {
    const pending = renderRoster({
      channels: undefined,
      isPending: true,
      query: "Ada",
      search: "Ada",
    });
    expect(pending.queryByText(/No goals match your search/)).toBeNull();
    expect(pending.queryByText(/don't have goals yet/)).toBeNull();
    cleanup();
    const placeholder = renderRoster({
      channels: [],
      isPending: false,
      isPlaceholderData: true,
      query: "missing",
      search: "missing",
    });
    expect(placeholder.queryByText(/No goals match your search/)).toBeNull();
    expect(placeholder.queryByText(/don't have goals yet/)).toBeNull();
  });
});

describe("goal roster filters", () => {
  test("searching, then changing All / Active / Completed, keeps the same query", () => {
    const seen: string[] = [];
    const view = renderRoster({
      query: "Ada",
      search: "Ada",
      onStatusChange: (status) => seen.push(status),
    });
    expect(
      (view.getByLabelText("Search goals") as HTMLInputElement).value,
    ).toBe("Ada");
    fireEvent.click(view.getByRole("button", { name: "Show active goals" }));
    fireEvent.click(view.getByRole("button", { name: "Show completed goals" }));
    fireEvent.click(view.getByRole("button", { name: "Show all goals" }));
    expect(seen).toEqual(["active", "completed", "all"]);
    expect(
      (view.getByLabelText("Search goals") as HTMLInputElement).value,
    ).toBe("Ada");
  });

  test("clearing the query empties the search box", () => {
    const withQuery = renderRoster({ search: "Ada", query: "Ada" });
    expect(
      (withQuery.getByLabelText("Search goals") as HTMLInputElement).value,
    ).toBe("Ada");
    cleanup();
    const cleared = renderRoster({ search: "", query: "" });
    expect(
      (cleared.getByLabelText("Search goals") as HTMLInputElement).value,
    ).toBe("");
  });

  test("Show more is how later pages are requested", () => {
    const loaded: number[] = [];
    const view = renderRoster({
      hasNextPage: true,
      onLoadMore: () => loaded.push(1),
    });
    fireEvent.click(view.getByRole("button", { name: "Show more" }));
    expect(loaded).toEqual([1]);
  });
});
