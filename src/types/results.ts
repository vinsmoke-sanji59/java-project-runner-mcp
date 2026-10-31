import type { ProjectStatus } from "./state.js";
import type { ErrorCode } from "../errors.js";

export interface ToolResultBase {
  success: boolean;
  projectId?: string;
  status?: ProjectStatus;
  exitCode?: number | null;
  message: string;
  logPath?: string;
  code?: ErrorCode;
  [key: string]: unknown;
}
