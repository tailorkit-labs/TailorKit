import { ClientProvider, defineRoute, Route } from "@tailorkit/app/client";

function Shell() {
  return (
    <ClientProvider>
      <Route />
    </ClientProvider>
  );
}

export default defineRoute({ shellComponent: Shell });
