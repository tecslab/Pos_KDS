import { describe, expect, it, vi } from "vitest";

import { moveCancellationFocus } from "./order-cancellation-panel";

describe("order cancellation confirmation focus", () => {
  it("moves focus into confirmation on open and restores the trigger on close", () => {
    const confirmation = { focus: vi.fn() };
    const trigger = { focus: vi.fn() };

    moveCancellationFocus(true, confirmation, trigger);

    expect(confirmation.focus).toHaveBeenCalledOnce();
    expect(trigger.focus).not.toHaveBeenCalled();

    moveCancellationFocus(false, confirmation, trigger);

    expect(trigger.focus).toHaveBeenCalledOnce();
  });
});
