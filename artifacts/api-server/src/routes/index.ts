import { Router, type IRouter } from "express";
import healthRouter from "./health";
import slateRouter from "./slate";
import tisRouter from "./tis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(slateRouter);
router.use(tisRouter);

export default router;
