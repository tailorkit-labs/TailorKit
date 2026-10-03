import { describe, expect, it } from "vite-plus/test";
import { createTailorKitSchema } from "./schema";
import { SerializedComponent } from "../spec/component";

describe("component children contract", () => {
  it("serializes containers and leaves with a boolean children capability", () => {
    const schema = createTailorKitSchema({
      components: { Card: { children: true }, Input: {}, Image: { children: false } },
    }).serialize();
    expect(schema.components.Card).toEqual({ callbacks: {}, fields: undefined, children: true });
    expect(schema.components.Input).toEqual({ callbacks: {}, fields: undefined, children: false });
    expect(schema.components.Image).toEqual({ callbacks: {}, fields: undefined, children: false });
    for (const component of Object.values(schema.components)) {
      expect(SerializedComponent.parse(component)).toEqual(component);
    }
  });
});
