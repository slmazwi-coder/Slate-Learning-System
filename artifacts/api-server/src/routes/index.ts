import { Router, type IRouter } from "express";
import healthRouter from "./health";
import slateRouter from "./slate";

const router: IRouter = Router();

router.use(healthRouter);
router.use(slateRouter);

export default router;
