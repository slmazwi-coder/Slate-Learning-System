import { Router, type IRouter } from "express";
import healthRouter from "./health";
import slateRouter from "./slate";
import tisRouter from "./tis";
import parentRouter from "./parent";
import tutorRouter from "./tutor";
import hodRouter from "./hod";
import accountsRouter from "./accounts";
import hostafricaRouter from "./hostafrica";
import supportRouter from "./support";

const router: IRouter = Router();

router.use(healthRouter);
router.use(slateRouter);
router.use(tisRouter);
router.use(parentRouter);
router.use(tutorRouter);
router.use(hodRouter);
router.use(accountsRouter);
router.use(hostafricaRouter);
router.use(supportRouter);

export default router;
