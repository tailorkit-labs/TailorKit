import { captcha } from "better-auth/plugins";
import { checkBotId } from "botid/server";
import { captchaEndpoints } from "./captcha-endpoints";

export const authCaptcha = captcha({
  provider: "vercel-botid",
  checkBotId,
  endpoints: captchaEndpoints,
});
