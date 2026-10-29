import { LogicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { Menu, MenuItemOptions, PredefinedMenuItemOptions } from "@tauri-apps/api/menu";
import type { MenuItem, MenuState } from "../components/ContextMenu";

const MODIFIERS: Record<string, string> = { "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift", "⌘": "CmdOrCtrl" };
const ID = "page-menu-";

/** "⌘⇧A" as Tauri reads it: "CmdOrCtrl+Shift+A". Undefined unless it is modifiers and one key. */
export function accelerator(shortcut: string): string | undefined {
  const keys = [...shortcut];
  const key = keys.pop();
  if (!key || key in MODIFIERS || !keys.length || !keys.every((k) => k in MODIFIERS)) return undefined;
  return [...keys.map((k) => MODIFIERS[k]), key].join("+");
}

/**
 * The items as Tauri's `Menu.new` takes them, with a separator where a group starts. Each item's
 * id says which one it is, for `chosenItem`.
 */
export function nativeItems(items: MenuItem[]): (MenuItemOptions | PredefinedMenuItemOptions)[] {
  return items.flatMap((item, i) => [
    ...(item.divider && i > 0 ? [{ item: "Separator" } as const] : []),
    { id: `${ID}${i}`, text: item.label, accelerator: item.shortcut && accelerator(item.shortcut) },
  ]);
}

/** The item a menu event's id names, if it is one of these. */
export function chosenItem(items: MenuItem[], id: string): MenuItem | undefined {
  return id.startsWith(ID) ? items[Number(id.slice(ID.length))] : undefined;
}

// The last menu shown. It is released when the next one opens, not when it closes, so the
// chosen item's event still finds it.
let shown: { menu: Menu; items: MenuItem[] } | null = null;
let listening: Promise<unknown> | null = null;

/** Shows the menu as a Mac menu at its point on the window. Resolves once it closes. */
export async function popupNativeMenu(menu: MenuState): Promise<void> {
  // Tauri's per-item callbacks never reached the page, so src-tauri/src/lib.rs sends the id.
  listening ??= listen<string>("menu-chosen", (e) => shown && chosenItem(shown.items, e.payload)?.run());
  await listening;
  const next = await Menu.new({ items: nativeItems(menu.items) });
  const last = shown;
  shown = { menu: next, items: menu.items };
  await last?.menu.close();
  await next.popup(new LogicalPosition(menu.x, menu.y));
}
