export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getAuthHandlers } = await import("./server/auth-runtime.ts");
    getAuthHandlers();
  }
}
