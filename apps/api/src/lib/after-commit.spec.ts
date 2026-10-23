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

  it("runs every task even when one fails, then rethrows the first error", async () => {
    const queue = afterCommitQueue();
    const first = vi.fn();
    const third = vi.fn();
    queue.add(first);
    queue.add(() => {
      throw new Error("second failed");
    });
    queue.add(third);

    await expect(queue.run()).rejects.toThrow("second failed");
    expect(first).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("rethrows the FIRST failure when several tasks fail", async () => {
    const queue = afterCommitQueue();
    queue.add(() => {
      throw new Error("one");
    });
    queue.add(async () => {
      throw new Error("two");
    });

    await expect(queue.run()).rejects.toThrow("one");
  });
});
