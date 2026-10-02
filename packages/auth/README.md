# Authentication bot protection

Better Auth's captcha plugin uses [Vercel BotID](https://vercel.com/docs/botid/get-started)
to protect email registration, password and email OTP sign-in, social sign-in
initiation, OTP sending and checking, and password recovery. The shared route
list lives in `src/lib/captcha-endpoints.ts` and supplies both the server plugin
and browser SDK.

The web app initializes BotID before creating the Better Auth client, which
captures the current `fetch` implementation. `apps/web/vercel.json` proxies
BotID's challenge and analysis scripts. Its configuration is tested against
the installed SDK so package updates cannot silently change these paths.

Production verification requires a Vercel deployment with OIDC tokens available
to the BotID SDK. Bot verdicts are rejected, including verified bots, and a
verification service failure blocks the request. OAuth callbacks and session
reads do not require browser challenges.

Local development skips browser challenges; the BotID server SDK allows local
requests by default. Validate sign-up, sign-in, OTP resending and password
recovery through the browser on a Vercel preview before releasing.

When regenerating the auth schema, disable secondary storage so the generated
schema includes verification tables needed by environments without KV:

```sh
KV_PROVIDER='' NODE_OPTIONS=--conditions=development pnpm --filter @tailorkit/auth generate
```
