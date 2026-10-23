import { describe, expect, it, vi } from "vitest";
import { afterCommitQueue } from "./after-commit";

describe("afterCommitQueue", () => {
  it("runs nothing until run() is called, then the tasks in order", async () => {
    const queue = afterCommitQueue();
    const order: string[] = [];
    queue.add(() => {
      order.push("first");
    });
    queue.add(async () => {
      await Promise.resolve();
      order.push("second");
    });
    expect(order).toEqual([]);

    await queue.run();
    expect(order).toEqual(["first", "second"]);
  });

  it("runs each task once even when run() is called twice", async () => {
    const queue = afterCommitQueue();
    const task = vi.fn();
    queue.add(task);

    await queue.run();
    await queue.run();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("propagates the first failure and skips the rest", async () => {
    const queue = afterCommitQueue();
    const later = vi.fn();
    queue.add(() => {
      throw new Error("boom");
    });
    queue.add(later);

    await expect(queue.run()).rejects.toThrow("boom");
    expect(later).not.toHaveBeenCalled();
  });
});
