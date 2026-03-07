import { describe, expect, it, vi } from "vitest";
import { showModal } from "../extensions/memory/src/ui.js";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

describe("ui", () => {
  it("returns early if no UI", async () => {
    const ctx = { hasUI: false } as ExtensionContext;
    await showModal(ctx, "Title", "Body");
    // No way to easily check if it returned early, but it shouldn't crash
  });

  it("calls ctx.ui.custom if UI is present", async () => {
    const done = vi.fn();
    const theme = {
      fg: vi.fn().mockReturnValue("colored"),
      bold: vi.fn().mockReturnValue("bolded"),
    };
    const ui = {
      custom: vi.fn().mockImplementation((fn) => {
        fn(null, theme, null, done);
        return Promise.resolve();
      }),
    };
    const ctx = { hasUI: true, ui } as unknown as ExtensionContext;

    await showModal(ctx, "Title", "Body");

    expect(ui.custom).toHaveBeenCalled();
    expect(theme.fg).toHaveBeenCalledWith("accent", "bolded");
    expect(theme.bold).toHaveBeenCalledWith("Title");

    // Test onKey handler
    const tuiCallback = (ui.custom as any).mock.calls[0][0];
    const textComponent = tuiCallback(null, theme, null, done);

    expect(textComponent.onKey("\x1b")).toBe(true);
    expect(done).toHaveBeenCalled();

    done.mockClear();
    expect(textComponent.onKey("\r")).toBe(true);
    expect(done).toHaveBeenCalled();

    done.mockClear();
    expect(textComponent.onKey("\x03")).toBe(true);
    expect(done).toHaveBeenCalled();

    done.mockClear();
    expect(textComponent.onKey("a")).toBe(true);
    expect(done).not.toHaveBeenCalled();
  });
});
