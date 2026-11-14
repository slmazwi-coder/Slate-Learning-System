import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensureSchema } from "./lib/schema-bootstrap";

const app: Express = express();
// Trust forwarded addresses only when the deployment explicitly configures the
// number of trusted reverse proxies. Direct deployments default to no trust.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (Number.isInteger(proxyHops) && proxyHops > 0) app.set("trust proxy", proxyHops);

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.slate-alis.co.za",
  "https://slate-alis.co.za",
  "https://slate-alis.vercel.app",
] as const;

const VERCEL_PREVIEW_HOST_RE = /(^|\.)[a-z0-9-]+-git-[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i;

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? DEFAULT_ALLOWED_ORIGINS),
);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:") return false;

    // Only permit Vercel previews with a Git branch-like hostname. This keeps the
    // development preview flow working without allowing arbitrary third-party
    // domains or unrelated *.vercel.app apps.
    if (hostname.endsWith(".vercel.app")) {
      if (process.env.VERCEL_ENV === "preview") return true;
      return VERCEL_PREVIEW_HOST_RE.test(hostname);
    }

    return false;
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
app.disable("x-powered-by");
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

// The API always answers with JSON. Express's default handler sends an HTML
// error page, and a client that parses JSON reports that as the confusing
// "Unexpected token '<' is not valid JSON". An explicit JSON 404 and error
// handler keep every /api response parseable, and the real failure reason goes
// to the logs instead of to the browser.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

const apiErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const thrown = error as { status?: unknown; statusCode?: unknown; expose?: unknown; message?: unknown };
  const rawStatus = typeof thrown.status === "number" ? thrown.status : thrown.statusCode;
  const status = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  if (status >= 500) logger.error({ err: error }, "unhandled API error");
  // A 4xx that http-errors marked exposable (e.g. a malformed JSON body) may show
  // its own message; anything else is a generic line so no internal detail leaks.
  const message = status < 500 && thrown.expose === true && typeof thrown.message === "string"
    ? thrown.message
    : "Something went wrong. Please try again.";
  res.status(status).json({ error: message });
};
app.use(apiErrorHandler);

export default app;
