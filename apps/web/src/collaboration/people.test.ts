import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { personName, usePersonPicture } from "../editor/references.js";
import { mockApi } from "../testing/render.js";
import { peopleLoader } from "./people.js";

describe("people search", () => {
  it("remembers names and pictures, so a person chosen from it shows the picture at once", async () => {
    const id = "01929b1e-0000-7000-8000-0000000000d4";
    mockApi({
      "GET /api/v1/people": () => ({
        body: {
          items: [{ id, name: "Mateo Rossi", email: null, type: "standard", pictureRef: "v7" }],
          nextCursor: null,
        },
      }),
    });
    await peopleLoader("Mateo", null);
    expect(personName(id)).toBe("Mateo Rossi");
    expect(renderHook(() => usePersonPicture(id)).result.current).toBe("v7");
  });
});
