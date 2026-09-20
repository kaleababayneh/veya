import React, { useCallback } from "react";
import { it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useRefresh } from "../src/lib/useRefresh";
it("hides the old transaction immediately and ignores its late response after identity changes", async () => {
  let resolveOld: (s: string) => void = () => {};
  const loadA = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveOld = resolve;
        }),
    ),
    loadB = vi.fn(async () => "new transaction");
  function View({ id }: { id: string }) {
    const load = useCallback(() => (id === "a" ? loadA() : loadB()), [id]);
    const { data } = useRefresh(load);
    return <div>{data ?? "loading"}</div>;
  }
  const view = render(<View id="a" />);
  view.rerender(<View id="b" />);
  await screen.findByText("new transaction");
  await act(async () => resolveOld("old transaction"));
  expect(screen.queryByText("old transaction")).toBeNull();
  expect(screen.getByText("new transaction")).toBeTruthy();
});
