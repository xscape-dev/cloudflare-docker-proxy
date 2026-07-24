const DOCKER_HUB = "https://registry-1.docker.io";

const ROUTES = {
  "docker.xscape.dev": DOCKER_HUB,
  "quay.xscape.dev": "https://quay.io",
  "gcr.xscape.dev": "https://gcr.io",
  "k8s-gcr.xscape.dev": "https://k8s.gcr.io",
  "k8s.xscape.dev": "https://registry.k8s.io",
  "ghcr.xscape.dev": "https://ghcr.io",
  "cloudsmith.xscape.dev": "https://docker.cloudsmith.io",
};

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

export function routeByHost(host, env = {}) {
  if (host in ROUTES) return ROUTES[host];
  return env.MODE === "debug" ? env.TARGET_UPSTREAM || "" : "";
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);
  const upstream = routeByHost(url.hostname, env);
  if (!upstream) return Response.json({ routes: ROUTES }, { status: 404 });

  const isDockerHub = upstream === DOCKER_HUB;
  const authorization = request.headers.get("Authorization");
  if (url.pathname === "/v2/") {
    const response = await fetch(`${upstream}/v2/`, {
      headers: authorization ? { Authorization: authorization } : undefined,
      redirect: "follow",
    });
    return response.status === 401 ? responseUnauthorized(url, env) : response;
  }

  if (url.pathname === "/v2/auth") {
    const response = await fetch(`${upstream}/v2/`, { redirect: "follow" });
    if (response.status !== 401) return response;
    const header = response.headers.get("WWW-Authenticate");
    if (!header) return response;
    let scope = url.searchParams.get("scope");
    if (scope && isDockerHub) scope = addDockerHubLibraryScope(scope);
    return fetchToken(parseAuthenticate(header), scope, authorization);
  }

  if (isDockerHub) {
    const redirected = dockerHubLibraryRedirect(url);
    if (redirected) return Response.redirect(redirected, 301);
  }

  // Preserve query parameters and the request body so registry uploads work.
  const upstreamUrl = new URL(url.pathname + url.search, upstream);
  const headers = new Headers(request.headers);
  headers.delete("Host");
  const response = await fetch(
    new Request(upstreamUrl, {
      method: request.method,
      headers,
      body: request.body,
      // Required by Node's Fetch implementation for stream bodies; ignored by Workers.
      duplex: "half",
      redirect: isDockerHub ? "manual" : "follow",
    })
  );
  if (response.status === 401) return responseUnauthorized(url, env);
  if (isDockerHub && response.status === 307) {
    const location = response.headers.get("Location");
    if (!location) return response;
    return fetch(location, { method: "GET", redirect: "follow" });
  }
  return response;
}

function dockerHubLibraryRedirect(url) {
  const parts = url.pathname.split("/");
  if (parts.length !== 5) return null;
  parts.splice(2, 0, "library");
  const redirected = new URL(url);
  redirected.pathname = parts.join("/");
  return redirected;
}

function addDockerHubLibraryScope(scope) {
  const parts = scope.split(":");
  if (parts.length === 3 && !parts[1].includes("/")) parts[1] = `library/${parts[1]}`;
  return parts.join(":");
}

function parseAuthenticate(value) {
  const params = Object.fromEntries(
    [...value.matchAll(/([a-z]+)="((?:\\.|[^"\\])*)"/gi)].map(([, key, item]) => [
      key.toLowerCase(),
      item.replace(/\\(.)/g, "$1"),
    ])
  );
  if (!params.realm || !params.service) throw new Error(`Invalid WWW-Authenticate header: ${value}`);
  return params;
}

function fetchToken(authenticate, scope, authorization) {
  const tokenUrl = new URL(authenticate.realm);
  tokenUrl.searchParams.set("service", authenticate.service);
  if (scope) tokenUrl.searchParams.set("scope", scope);
  return fetch(tokenUrl, { headers: authorization ? { Authorization: authorization } : undefined });
}

function responseUnauthorized(url, env) {
  const protocol = env.MODE === "debug" ? "http" : "https";
  return Response.json(
    { message: "UNAUTHORIZED" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer realm="${protocol}://${url.host}/v2/auth",service="cloudflare-docker-proxy"`,
      },
    }
  );
}
