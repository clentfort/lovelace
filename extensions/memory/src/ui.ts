import { Key, Text, matchesKey } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export async function showModal(ctx: ExtensionContext, title: string, body: string): Promise<void> {
  if (!ctx.hasUI) return;
  await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
    const lines = `${theme.fg("accent", theme.bold(title))}\n\n${body}\n\n${theme.fg("dim", "Press Enter or Escape to close")}`;
    const text = new Text(lines, 1, 1);

    return {
      render: (width) => text.render(width),
      invalidate: () => text.invalidate(),
      handleInput: (key) => {
        if (
          matchesKey(key, Key.escape) ||
          matchesKey(key, Key.enter) ||
          matchesKey(key, Key.return) ||
          matchesKey(key, Key.ctrl("c"))
        ) {
          done();
        }
      },
    };
  });
}
