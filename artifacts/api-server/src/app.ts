import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensureSchema } from "./lib/schema-bootstrap";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

// Make sure schema additions exist before any route touches the database.
app.use("/api", (_req, _res, next) => {
  ensureSchema().then(() => next(), next);
});

app.use("/api", router);

export default app;
