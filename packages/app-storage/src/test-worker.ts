// Type generation fixture; integration tests build the persistent example's real Worker.
import { DurableObject } from "cloudflare:workers";

export class AppStorage extends DurableObject {}
export default { fetch: () => new Response("Type generation fixture") };
