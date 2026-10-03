import { expect, it } from "vite-plus/test";
import { getViewDepth, getViewHierarchy, isViewAncestor } from "./views";

it("uses whole path segments for ancestry and includes undeclared intermediate paths", () => {
  expect(getViewHierarchy("/users/detail/settings")).toEqual([
    "/users/detail/settings",
    "/users/detail",
    "/users",
    "/",
  ]);
  expect(getViewHierarchy("/")).toEqual(["/"]);
  expect(isViewAncestor("/user", "/users")).toBe(false);
  expect(isViewAncestor("/users", "/users/detail")).toBe(true);
  expect(isViewAncestor("/users", "/users")).toBe(true);
  expect(isViewAncestor("/", "/users")).toBe(true);
  expect(getViewDepth("/")).toBe(0);
  expect(getViewDepth("/users/detail")).toBe(2);
});
