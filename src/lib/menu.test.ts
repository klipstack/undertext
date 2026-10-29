import type { MenuItemOptions, PredefinedMenuItemOptions } from "@tauri-apps/api/menu";
import { describe, expect, it } from "vitest";
import { accelerator, chosenItem, nativeItems } from "./menu";

/** Either kind of item, so a test can read any field. */
type Option = Partial<MenuItemOptions> & Partial<PredefinedMenuItemOptions>;

describe("accelerator", () => {
  it("writes a shortcut the way Tauri reads it", () => {
    expect(accelerator("⌘K")).toBe("CmdOrCtrl+K");
    expect(accelerator("⌘⇧A")).toBe("CmdOrCtrl+Shift+A");
    expect(accelerator("⌘/")).toBe("CmdOrCtrl+/");
    expect(accelerator("⌃⌥⌘D")).toBe("Ctrl+Alt+CmdOrCtrl+D");
  });

  it("has none for a shortcut without a modifier and a key", () => {
    expect(accelerator("esc")).toBeUndefined();
    expect(accelerator("⌘")).toBeUndefined();
    expect(accelerator("K")).toBeUndefined();
  });
});

describe("nativeItems", () => {
  it("keeps the labels and shortcuts, with a separator where a group starts", () => {
    const items = nativeItems([
      { label: "their", divider: true, run: () => {} },
      { label: "Learn spelling", run: () => {} },
      { label: "Ghost it", shortcut: "⌘/", divider: true, run: () => {} },
      { label: "All commands…", shortcut: "⌘K", run: () => {} },
    ]) as Option[];
    expect(items.map(({ text, accelerator, item }) => ({ text, accelerator, item }))).toEqual([
      { text: "their", accelerator: undefined, item: undefined },
      { text: "Learn spelling", accelerator: undefined, item: undefined },
      { text: undefined, accelerator: undefined, item: "Separator" },
      { text: "Ghost it", accelerator: "CmdOrCtrl+/", item: undefined },
      { text: "All commands…", accelerator: "CmdOrCtrl+K", item: undefined },
    ]);
  });

  it("finds the chosen item by its id", () => {
    const items = [
      { label: "First", run: () => {} },
      { label: "Second", divider: true, run: () => {} },
    ];
    const ids = (nativeItems(items) as Option[]).map((o) => o.id);
    expect(ids).toEqual(["page-menu-0", undefined, "page-menu-1"]);
    expect(chosenItem(items, "page-menu-1")?.label).toBe("Second");
    expect(chosenItem(items, "page-menu-0")?.label).toBe("First");
    expect(chosenItem(items, "30")).toBeUndefined();
  });
});
