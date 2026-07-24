import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest, routeByHost } from "../src/index.js";

test("uses configured upstream for a production host", () => {
  assert.equal(routeByHost("ghcr.xscape.dev"), "https://ghcr.io");
  assert.equal(routeByHost("unknown.example"), "");
});

test("uses the development upstream only in debug mode", () => {
  assert.equal(
    routeByHost("localhost", { MODE: "debug", TARGET_UPSTREAM: "https://registry.example" }),
    "https://registry.example"
  );
});

test("forwards query parameters and request body", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (request) => {
    forwarded = request;
    return new Response("ok");
  };
  try {
    const request = new Request("https://docker.xscape.dev/v2/repo/blobs/uploads/?mount=sha256%3Aabc", {
      method: "POST",
      body: "layer-data",
    });
    const response = await handleRequest(request);
    assert.equal(await response.text(), "ok");
    assert.equal(forwarded.url, "https://registry-1.docker.io/v2/repo/blobs/uploads/?mount=sha256%3Aabc");
    assert.equal(await forwarded.text(), "layer-data");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
