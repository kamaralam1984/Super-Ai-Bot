import { describe, it, expect } from "vitest";
import { restGet, graphqlQuery, MutationRejectedError, RateLimitedError, CircuitOpenError, getCircuitState, resetConnectorResilienceState } from "./readOnlyHttpClient";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";
import type { ConnectorRuntimeConfig } from "../types";

const NONE_CRED = { authMethod: "NONE" as const };

function withConfig(overrides: Partial<ConnectorRuntimeConfig>): ConnectorRuntimeConfig {
  return { ...DEFAULT_CONNECTOR_CONFIG, ...overrides };
}

describe("restGet — real network", () => {
  it("fetches real, parseable JSON from a real WordPress REST API", async () => {
    const connectorId = `test-restget-wp-${Date.now()}`;
    const response = await restGet({
      connectorId,
      baseUrl: "https://wptavern.com",
      path: "/wp-json/wp/v2/posts?per_page=1",
      credential: NONE_CRED,
      config: withConfig({}),
    });
    expect(response.ok).toBe(true);
    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body.toString("utf-8"));
    expect(Array.isArray(parsed)).toBe(true);
  }, 20_000);

  it("rejects a non-GET/HEAD method at the type/runtime boundary", async () => {
    await expect(
      restGet({
        connectorId: "test-restget-badmethod",
        baseUrl: "https://wptavern.com",
        path: "/",
        method: "POST" as never,
        credential: NONE_CRED,
        config: withConfig({}),
      })
    ).rejects.toThrow(/GET\/HEAD/);
  });

  it("locally rate-limits before making a second real request when maxTokens is exhausted", async () => {
    const connectorId = `test-restget-ratelimit-${Date.now()}`;
    const config = withConfig({ rateLimit: { maxTokens: 1, refillPerSecond: 0.001 } });
    const first = await restGet({ connectorId, baseUrl: "https://wptavern.com", path: "/", method: "HEAD", credential: NONE_CRED, config });
    expect(first.statusCode).toBeGreaterThan(0);
    await expect(restGet({ connectorId, baseUrl: "https://wptavern.com", path: "/", method: "HEAD", credential: NONE_CRED, config })).rejects.toBeInstanceOf(RateLimitedError);
  }, 20_000);

  it("opens the circuit breaker after repeated real SSRF-blocked failures, honoring THIS connector's own failureThreshold (regression: breaker used to be a single shared instance ignoring per-connector config)", async () => {
    const connectorId = `test-restget-circuit-${Date.now()}`;
    const config = withConfig({ circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 }, retryPolicy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 } });

    for (let i = 0; i < 2; i++) {
      await expect(restGet({ connectorId, baseUrl: "http://169.254.169.254", path: "/", method: "HEAD", credential: NONE_CRED, config })).rejects.toThrow();
    }
    expect(getCircuitState(connectorId)).toBe("OPEN");
    await expect(restGet({ connectorId, baseUrl: "http://169.254.169.254", path: "/", method: "HEAD", credential: NONE_CRED, config })).rejects.toBeInstanceOf(CircuitOpenError);
  }, 20_000);

  it("a second connector's circuit breaker is unaffected by the first connector's failures", async () => {
    const failingId = `test-restget-isolation-fail-${Date.now()}`;
    const healthyId = `test-restget-isolation-ok-${Date.now()}`;
    const tightConfig = withConfig({ circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 60_000 }, retryPolicy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 } });

    await expect(restGet({ connectorId: failingId, baseUrl: "http://169.254.169.254", path: "/", method: "HEAD", credential: NONE_CRED, config: tightConfig })).rejects.toThrow();
    expect(getCircuitState(failingId)).toBe("OPEN");

    const healthy = await restGet({ connectorId: healthyId, baseUrl: "https://wptavern.com", path: "/", method: "HEAD", credential: NONE_CRED, config: tightConfig });
    expect(healthy.statusCode).toBeGreaterThan(0);
    expect(getCircuitState(healthyId)).toBe("CLOSED");
  }, 20_000);

  it("resetConnectorResilienceState re-opens a tripped connector for new attempts", async () => {
    const connectorId = `test-restget-reset-${Date.now()}`;
    const config = withConfig({ circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 60_000 }, retryPolicy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 } });
    await expect(restGet({ connectorId, baseUrl: "http://169.254.169.254", path: "/", method: "HEAD", credential: NONE_CRED, config })).rejects.toThrow();
    expect(getCircuitState(connectorId)).toBe("OPEN");
    resetConnectorResilienceState(connectorId);
    expect(getCircuitState(connectorId)).toBe("CLOSED");
  }, 20_000);
});

describe("graphqlQuery — real network", () => {
  it("runs a real introspection query against a real public GraphQL API", async () => {
    const response = await graphqlQuery({
      connectorId: `test-graphql-introspect-${Date.now()}`,
      baseUrl: "https://countries.trevorblades.com",
      path: "/graphql",
      query: "query IntrospectionProbe { __schema { queryType { name } } }",
      credential: NONE_CRED,
      config: withConfig({}),
    });
    expect(response.ok).toBe(true);
    const parsed = JSON.parse(response.body.toString("utf-8"));
    expect(parsed.data.__schema.queryType.name).toBe("Query");
  }, 20_000);

  it("runs a real read query and gets real data back", async () => {
    const response = await graphqlQuery({
      connectorId: `test-graphql-read-${Date.now()}`,
      baseUrl: "https://countries.trevorblades.com",
      path: "/graphql",
      query: "query { country(code: \"IN\") { name capital } }",
      credential: NONE_CRED,
      config: withConfig({}),
    });
    const parsed = JSON.parse(response.body.toString("utf-8"));
    expect(parsed.data.country.name).toBe("India");
  }, 20_000);

  it("rejects a mutation before ever making the network call", async () => {
    await expect(
      graphqlQuery({
        connectorId: "test-graphql-mutation-reject",
        baseUrl: "https://countries.trevorblades.com",
        path: "/graphql",
        query: "mutation { deleteEverything }",
        credential: NONE_CRED,
        config: withConfig({}),
      })
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("rejects a subscription operation", async () => {
    await expect(
      graphqlQuery({
        connectorId: "test-graphql-subscription-reject",
        baseUrl: "https://countries.trevorblades.com",
        path: "/graphql",
        query: "subscription { onOrderCreated { id } }",
        credential: NONE_CRED,
        config: withConfig({}),
      })
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("does not reject a query that merely mentions 'mutation' inside a string literal argument", async () => {
    // Guards against an over-eager regex that would block legitimate queries filtering on a field/argument named similarly.
    const response = await graphqlQuery({
      connectorId: `test-graphql-falsepositive-${Date.now()}`,
      baseUrl: "https://countries.trevorblades.com",
      path: "/graphql",
      query: 'query { country(code: "IN") { name } } # not a mutation, just a comment mentioning the word',
      credential: NONE_CRED,
      config: withConfig({}),
    });
    expect(response.ok).toBe(true);
  }, 20_000);
});
