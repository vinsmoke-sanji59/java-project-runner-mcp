import { isLoopbackUrl } from "../security/path-policy.js";

export async function checkLoopbackHealth(
  url: string,
  timeoutMs = 2000,
): Promise<"healthy" | "unhealthy"> {
  if (!isLoopbackUrl(url)) {
    return "unhealthy";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? "healthy" : "unhealthy";
  } catch {
    return "unhealthy";
  } finally {
    clearTimeout(timer);
  }
}
