import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensureSchema } from "./lib/schema-bootstrap";

const app: Express = express();

// Only these origins may call the API with credentials. Configurable through
// ALLOWED_ORIGINS (comma-separated); the production domains and the Vercel
// preview domain are the defaults.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.slate-alis.co.za",
  "https://slate-alis.co.za",
  "https://slate-alis.vercel.app",
];
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? DEFAULT_ALLOWED_ORIGINS),
);
// Vercel preview deployments use per-branch hostnames like
// slate-alis-git-branch-team.vercel.app, so the whole vercel.app suffix is
// allowed rather than pinning one preview domain.
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "https:" && hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

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
// Standard security headers. crossOriginResourcePolicy is relaxed so the SPA
// on a different origin can still read API responses.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (originAllowed(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(cookieParser(process.env.SESSION_SECRET));
// Cap request bodies. Base64 uploads (curriculum, scanned pages, profile
// images) fit within 8 MB; everything else is smaller. urlencoded is capped
// too so a form post cannot bypass the JSON limit.
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Make sure schema additions exist before any route touches the database.
app.use("/api", (_req, _res, next) => {
  ensureSchema().then(() => next(), next);
});

app.use("/api", router);

export default app;
