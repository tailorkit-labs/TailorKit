import { Window } from "happy-dom";
import { h, createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.stubGlobal("__PREACT_VERSION__", "10.29.8");
const { defineClient } = await import("./index");
afterEach(() => vi.unstubAllGlobals());

it("keeps the app wrapper mounted across view changes and cleans it up on unmount", async () => {
  const window = new Window();
  vi.stubGlobal("document", window.document);
  const root = document.createElement("div");
  const Context = createContext("missing");
  const mount = vi.fn();
  const cleanup = vi.fn();
  const client = defineClient({
    slots: {},
    component: ({ children }) => {
      useEffect(() => {
        mount();
        return cleanup;
      }, []);
      return h(Context.Provider, { value: "shared" }, children);
    },
  });
  function First() {
    return h("div", {}, `First: ${useContext(Context)}`);
  }
  function Second() {
    return h("div", {}, `Second: ${useContext(Context)}`);
  }
  await act(() => client.$runtime.render(h(First, {}), root));
  expect(root.textContent).toBe("First: shared");
  await act(() => client.$runtime.render(h(Second, {}), root));
  expect(root.textContent).toBe("Second: shared");
  expect(mount).toHaveBeenCalledOnce();
  expect(cleanup).not.toHaveBeenCalled();
  await act(() => client.$runtime.render(null, root));
  expect(cleanup).toHaveBeenCalledOnce();
  expect(root.textContent).toBe("");
  await window.happyDOM.close();
});
