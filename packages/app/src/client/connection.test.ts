import { expect, it, vi } from "vite-plus/test";
import { createClient, reference } from "./connection";

const session = {
  url: "https://runtime.test/rpc/",
  token: "token",
  expiresAt: Date.now() + 60_000,
};

it("routes normal calls over authenticated HTTP without opening a WebSocket", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ json: "ok" }));
  const connect = vi.fn();
  const client = createClient({ getSession: () => Promise.resolve(session), fetch, connect });
  const requestId = crypto.randomUUID();
  try {
    expect(await client.query(reference("todos.list", "query"), { filter: "open" })).toBe("ok");
    fetch.mockResolvedValueOnce(Response.json({ json: "saved" }));
    expect(
      await client.mutate(reference("todos.add", "mutation"), { text: "todo" }, { requestId }),
    ).toBe("saved");
    fetch.mockResolvedValueOnce(Response.json({ json: "done" }));
    expect(await client.action(reference("tasks.import", "action"))).toBe("done");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://runtime.test/rpc/queries",
      "https://runtime.test/rpc/mutations",
      "https://runtime.test/rpc/actions",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "omit",
      body: JSON.stringify({ json: { name: "todos.list", args: { filter: "open" } } }),
    });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer token",
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).json).toEqual({
      name: "todos.add",
      args: { text: "todo" },
      requestId,
    });
    expect(connect).not.toHaveBeenCalled();
  } finally {
    client.close();
  }
});

it("preserves runtime errors without retrying actions", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      Response.json(
        { json: { code: "CONFLICT", message: "Already imported", defined: false } },
        { status: 409 },
      ),
    );
  const client = createClient({ getSession: () => Promise.resolve(session), fetch });
  try {
    await expect(client.action(reference("import", "action"))).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Already imported",
    });
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    client.close();
  }
});

it("aborts pending HTTP calls when closed", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetch = vi.fn<typeof globalThis.fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
        started();
      }),
  );
  const client = createClient({ getSession: () => Promise.resolve(session), fetch });
  const call = client.action(reference("import", "action"));
  const assertion = expect(call).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await ready;
  client.close();
  await assertion;
});

it("retries a lost mutation response with the same ID and frozen arguments", async () => {
  vi.useFakeTimers();
  const receipts = new Map<string, string>();
  let writes = 0;
  const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
    const { json } = JSON.parse(String(init?.body));
    const prior = receipts.get(json.requestId);
    if (prior) {
      return Promise.resolve(Response.json({ json: prior }));
    }
    writes += 1;
    receipts.set(json.requestId, json.args.text);
    return Promise.reject(new TypeError("Response lost after committing"));
  });
  const client = createClient({ getSession: () => Promise.resolve(session), fetch });
  try {
    const args = { text: "original" };
    const result = client.mutate(reference("todos.add", "mutation"), args);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    args.text = "changed";
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("original");
    expect(writes).toBe(1);
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).json);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0].requestId).toMatch(/^[0-9a-f-]{36}$/u);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it("backs off transient mutation failures and preserves an explicit request ID", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("Gateway unavailable", { status: 502 }))
    .mockResolvedValueOnce(new Response("Service unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response("Gateway timeout", { status: 504 }))
    .mockResolvedValueOnce(Response.json({ json: "saved" }));
  const client = createClient({ getSession: () => Promise.resolve(session), fetch });
  try {
    const requestId = crypto.randomUUID();
    const result = client.mutate(reference("save", "mutation"), undefined, { requestId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBe("saved");
    expect(
      fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).json.requestId),
    ).toEqual([requestId, requestId, requestId, requestId]);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it.each(["BAD_REQUEST", "FORBIDDEN", "CONFLICT", "INCOMPATIBLE_VERSION", "INTERNAL_SERVER_ERROR"])(
  "does not retry a mutation rejected with %s",
  async (code) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ json: { code, message: "Rejected", defined: false } }, { status: 500 }),
      );
    const client = createClient({ getSession: () => Promise.resolve(session), fetch });
    try {
      await expect(client.mutate(reference("save", "mutation"))).rejects.toMatchObject({ code });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      client.close();
    }
  },
);

it("refreshes authentication once for a mutation without changing its request ID", async () => {
  const getSession = vi.fn(({ refresh }: { refresh: boolean }) =>
    Promise.resolve({
      ...session,
      token: refresh ? "fresh" : "expired",
    }),
  );
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { json: { code: "UNAUTHORIZED", message: "Expired", defined: false } },
        { status: 401 },
      ),
    )
    .mockResolvedValueOnce(Response.json({ json: "saved" }));
  const client = createClient({ getSession, fetch });
  try {
    expect(await client.mutate(reference("save", "mutation"))).toBe("saved");
    expect(getSession.mock.calls).toEqual([[{ refresh: false }], [{ refresh: true }]]);
    const headers = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("authorization"),
    );
    expect(headers).toEqual(["Bearer expired", "Bearer fresh"]);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
  } finally {
    client.close();
  }
});

it("stops when refreshed authentication is still rejected", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() =>
      Promise.resolve(
        Response.json(
          { json: { code: "UNAUTHORIZED", message: "Rejected", defined: false } },
          { status: 401 },
        ),
      ),
    );
  const client = createClient({ getSession: () => Promise.resolve(session), fetch });
  try {
    await expect(client.mutate(reference("save", "mutation"))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    client.close();
  }
});

it("cancels a mutation waiting to retry when the client closes", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("Offline"));
  const client = createClient({ getSession: () => Promise.resolve(session), fetch });
  try {
    const assertion = expect(client.mutate(reference("save", "mutation"))).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    client.close();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    client.close();
    vi.useRealTimers();
  }
});

it.each(["query", "action"] as const)(
  "does not retry %s calls after a network failure",
  async (kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("Offline"));
    const client = createClient({ getSession: () => Promise.resolve(session), fetch });
    try {
      const result =
        kind === "query"
          ? client.query(reference("read", "query"))
          : client.action(reference("external", "action"));
      await expect(result).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      client.close();
    }
  },
);

it("retries when the connection drops while reading a mutation response body", async () => {
  vi.useFakeTimers();
  const brokenResponse = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("Response interrupted"));
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(brokenResponse)
    .mockResolvedValueOnce(Response.json({ json: "saved" }));
  const client = createClient({ getSession: () => Promise.resolve(session), fetch });
  try {
    const result = client.mutate(reference("save", "mutation"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("saved");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
  } finally {
    client.close();
    vi.useRealTimers();
  }
});
