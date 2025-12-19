import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { TaskSchema, GetTasksQuerySchema } from "@calibra-facil/schemas";

export const tasksRouter = new Hono()
  .get("/", zValidator("query", GetTasksQuerySchema), (c) => {
    const query = c.req.valid("query");
    return c.json({ tasks: [] });
  })
  .post("/", zValidator("json", TaskSchema), (c) => {
    const body = c.req.valid("json");
    return c.json({ item: body }, 201);
  });
