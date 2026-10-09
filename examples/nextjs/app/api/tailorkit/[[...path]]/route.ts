import { tailorKit } from "@/lib/tailorkit-server";

const handle = (request: Request) => tailorKit.handler(request);

export const GET = handle;
export const POST = handle;
