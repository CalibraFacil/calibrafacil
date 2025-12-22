import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter } from "./routes/auth";
import { tasksRouter } from "./routes/tasks";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

const routes = app
  .get("/hello", (c) => {
    return c.json({ message: "Hello!" });
  })
  .route("/api/auth", authRouter)
  .route("/tasks", tasksRouter);

export type AppType = typeof routes;
export default app;
