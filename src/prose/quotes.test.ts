import { describe, expect, it } from "vitest";
import { curlQuotes } from "./quotes";

describe("curly quotes", () => {
  it("open at the start, after a space, a bracket, a quote, or a >, and close otherwise", () => {
    expect(curlQuotes(`"Don't," she said. 'Fine.'`)).toBe("“Don’t,” she said. ‘Fine.’");
    expect(curlQuotes(`"'Hi,' he said."`)).toBe("“‘Hi,’ he said.”");
    expect(curlQuotes(`>"Hi," she said.`)).toBe(">“Hi,” she said.");
    expect(curlQuotes(`one\n"two"`)).toBe("one\n“two”");
  });

  it("look past emphasis marks before a quote", () => {
    expect(curlQuotes(`He said ("yes") and *"no"*.`)).toBe("He said (“yes”) and *“no”*.");
  });
});
