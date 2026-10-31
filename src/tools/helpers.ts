import { isAppError } from "../errors.js";
import type { ToolResultBase } from "../types/results.js";

export function okResult(data: ToolResultBase) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data as Record<string, unknown>,
  };
}

export function errResult(err: unknown) {
  if (isAppError(err)) {
    const data: ToolResultBase = {
      success: false,
      code: err.code,
      message: err.message,
    };
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
      structuredContent: data as Record<string, unknown>,
    };
  }
  const data: ToolResultBase = {
    success: false,
    message: err instanceof Error ? err.message : String(err),
  };
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data as Record<string, unknown>,
  };
}
