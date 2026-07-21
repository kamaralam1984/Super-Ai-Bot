import { Router } from "express";
import { systemCheckRouter } from "./systemCheck.routes";
import { environmentRouter } from "./environment.routes";
import { websiteValidationRouter } from "./websiteValidation.routes";
import { configurationRouter } from "./configuration.routes";
import { databaseRouter } from "./database.routes";
import { directoryRouter } from "./directory.routes";
import { installRouter } from "./install.routes";
import { logsRouter } from "./logs.routes";
import { scanRouter } from "./scan.routes";
import { knowledgeRouter } from "./knowledge.routes";
import { techDetectRouter } from "./techdetect.routes";
import { connectorRouter } from "./connector.routes";
import { trainingRouter } from "./training.routes";
import { permissionRouter } from "./permission.routes";
import { chatRouter } from "./chat.routes";
import { monitorWebhookRouter } from "./monitorWebhook.routes";
import { monitorRouter } from "./monitor.routes";
import { deploymentRouter } from "./deployment.routes";

/**
 * Root API router. Each installer step mounts its own sub-router here as it's
 * implemented (system-check, environment, website-validation, install, etc.).
 */
export const apiRouter = Router();

apiRouter.get("/ping", (_req, res) => {
  res.json({ success: true, message: "pong" });
});

apiRouter.use("/system-check", systemCheckRouter);
apiRouter.use("/environment", environmentRouter);
apiRouter.use("/website-validation", websiteValidationRouter);
apiRouter.use("/configuration", configurationRouter);
apiRouter.use("/database", databaseRouter);
apiRouter.use("/directories", directoryRouter);
apiRouter.use("/install", installRouter);
apiRouter.use("/logs", logsRouter);
apiRouter.use("/scan", scanRouter);
apiRouter.use("/knowledge", knowledgeRouter);
apiRouter.use("/techdetect", techDetectRouter);
apiRouter.use("/connector", connectorRouter);
apiRouter.use("/training", trainingRouter);
apiRouter.use("/permission", permissionRouter);
apiRouter.use("/chat", chatRouter);
apiRouter.use("/monitor", monitorWebhookRouter);
apiRouter.use("/monitor", monitorRouter);
apiRouter.use("/deployment", deploymentRouter);
