import { describe, expect, it } from "vite-plus/test";
import { resolvePath } from "./utils";

describe("workspace paths", () => {
  it.each([
    [undefined, "/workspace/app"],
    [".", "/workspace/app"],
    ["./src/new", "/workspace/app/src/new"],
    ["src/../new", "/workspace/app/new"],
    ["../shared", "/workspace/shared"],
    ["-", "/workspace/app/-"],
    ["a'b\n.txt", "/workspace/app/a'b\n.txt"],
    ["/tmp/new", "/tmp/new"],
    ["/tmp/../new", "/tmp/../new"],
  ])("resolves %s to %s", (path, expected) => {
    expect(resolvePath(path)).toBe(expected);
  });
});
