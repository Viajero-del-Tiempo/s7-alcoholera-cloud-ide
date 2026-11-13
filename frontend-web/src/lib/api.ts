export const API_BASE = (
  import.meta.env.VITE_API_BASE || "http://localhost:8000"
).replace(/\/$/, "");
export const WS_URL = `${API_BASE.replace(/^http/, "ws")}/ws/telemetry`;
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeout = 12000,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const response = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const detail =
      typeof result === "object" && result !== null && "detail" in result
        ? (result as { detail: unknown }).detail
        : `HTTP ${response.status}`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
    );
  }
  return result as T;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
