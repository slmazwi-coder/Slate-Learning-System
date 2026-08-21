import { Router, type IRouter } from "express";
import healthRouter from "./health";
import slateRouter from "./slate";
import tisRouter from "./tis";
import parentRouter from "./parent";
import tutorRouter from "./tutor";

const router: IRouter = Router();

router.use(healthRouter);
router.use(slateRouter);
router.use(tisRouter);
router.use(parentRouter);
router.use(tutorRouter);

export default router;
