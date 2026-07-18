import { getAuthHandlers } from "./auth-runtime.ts";
import { validateReceiptRuntimeAtStartup } from "./receipt-runtime.ts";

getAuthHandlers();
validateReceiptRuntimeAtStartup();
