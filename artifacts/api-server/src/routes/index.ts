import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import resumeRouter from "./resume";
import jobsRouter from "./jobs";
import applicationsRouter from "./applications";
import settingsRouter from "./settings";
import schedulerRouter from "./scheduler";
import statsRouter from "./stats";
import aiRouter from "./ai";
import proxiesRouter from "./proxies";
import greenhouseRouter from "./greenhouse";
import importRouter from "./import";
import questionsRouter from "./questions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(resumeRouter);
router.use(jobsRouter);
router.use(applicationsRouter);
router.use(settingsRouter);
router.use(schedulerRouter);
router.use(statsRouter);
router.use(aiRouter);
router.use(proxiesRouter);
router.use(greenhouseRouter);
router.use(importRouter);
router.use(questionsRouter);

export default router;
