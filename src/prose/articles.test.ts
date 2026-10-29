import { describe, expect, it } from "vitest";
import { startsWithVowelSound } from "./articles";

describe("a or an", () => {
  it("goes by the sound a word starts with, not its letter", () => {
    expect(startsWithVowelSound("hour")).toBe(true);
    expect(startsWithVowelSound("user")).toBe(false);
  });
});
