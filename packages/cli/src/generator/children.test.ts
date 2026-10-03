import { createRemoteComponent } from "@tailorkit/app";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderGeneratedTypes } from "./types";

describe("children-only components", () => {
  it("generates opt-in children and leaf component bindings", () => {
    const output = renderGeneratedTypes({
      components: {
        Card: { callbacks: {}, children: true },
        Input: { callbacks: {}, children: false },
        Image: { callbacks: {}, children: false },
      },
      views: {},
    });
    expect(output).toContain('createRemoteComponent<CardProps, true>("Card", {\n  children: true,');
    expect(output).toContain(
      'createRemoteComponent<InputProps, false>("Input", {\n  children: false,',
    );
    expect(output).toContain(
      'createRemoteComponent<ImageProps, false>("Image", {\n  children: false,',
    );
  });

  it("rejects components without a serialized children value", () => {
    expect(() =>
      renderGeneratedTypes({
        components: {
          Input: { callbacks: {} },
        },
        views: {},
      }),
    ).toThrow();
  });

  it("preserves multiple children and nested remote components", () => {
    const Card = createRemoteComponent<object, true>("Card", { children: true });
    const nested = Card({ children: "nested" });
    const children = ["first", 0, nested];
    const node = Card({ children });
    expect(node).toMatchObject({ type: "tailorkit-card", props: { children } });
  });

  it("preserves callback dispatch alongside children", () => {
    const onClick = vi.fn();
    const Button = createRemoteComponent<{ onClick: () => void }, true>("Button", {
      children: true,
      callbacks: { onClick: 0 },
    });
    const node = Button({ children: "Save", onClick });
    expect(node).toMatchObject({ type: "tailorkit-button", props: { children: "Save" } });
    if (!node || typeof node !== "object" || !("props" in node)) {
      throw new Error("Expected a remote component node");
    }
    const props = node.props as {
      ontailorkitcallbackonclick: (event: { detail: unknown[] }) => void;
    };
    props.ontailorkitcallbackonclick({ detail: [] });
    expect(onClick).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not forward children supplied to leaf components at runtime", () => {
    const Leaf = createRemoteComponent<object>("Leaf");
    // @ts-expect-error exercise untyped callers that bypass the generated contract
    const node = Leaf({ children: "not allowed" });
    expect(node).toMatchObject({ type: "tailorkit-leaf", props: { children: undefined } });
  });
});
