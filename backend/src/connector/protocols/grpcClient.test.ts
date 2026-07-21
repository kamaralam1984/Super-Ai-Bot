import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { grpcCall, GrpcMethodNotAllowedError, materializeProtoFile, resolvePackagePath } from "./grpcClient";
import type { GrpcConnectionConfig } from "../types";

// Real, in-process gRPC server (no mocking of @grpc/grpc-js) — matching
// this codebase's established preference for testing against real
// infrastructure wherever feasible, not a mock of the library itself.
const PROTO_SOURCE = `
syntax = "proto3";
package testpkg;

service TestService {
  rpc GetProducts (GetProductsRequest) returns (GetProductsResponse);
  rpc AlwaysFails (GetProductsRequest) returns (GetProductsResponse);
}

message GetProductsRequest {
  string category = 1;
}

message GetProductsResponse {
  repeated string names = 1;
}
`;

let server: grpc.Server;
let port: number;
let serverProtoFilePath: string;

beforeAll(async () => {
  serverProtoFilePath = path.join(os.tmpdir(), `kvl-grpc-test-server-${crypto.randomBytes(6).toString("hex")}.proto`);
  await fs.writeFile(serverProtoFilePath, PROTO_SOURCE, "utf-8");

  const packageDefinition = await protoLoader.load(serverProtoFilePath, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const grpcObject = grpc.loadPackageDefinition(packageDefinition) as unknown as { testpkg: { TestService: grpc.ServiceClientConstructor & { service: grpc.ServiceDefinition } } };
  const TestService = grpcObject.testpkg.TestService;

  server = new grpc.Server();
  server.addService(TestService.service, {
    GetProducts: (call: grpc.ServerUnaryCall<{ category?: string }, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      callback(null, { names: [`product-in-${call.request.category || "all"}`] });
    },
    AlwaysFails: (_call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      callback({ code: grpc.status.INTERNAL, message: "simulated failure", name: "Error" } as grpc.ServiceError, null);
    },
  });

  port = await new Promise<number>((resolve, reject) => {
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) reject(err);
      else resolve(boundPort);
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  await fs.unlink(serverProtoFilePath).catch(() => undefined);
});

function grpcConfig(overrides: Partial<GrpcConnectionConfig> = {}): GrpcConnectionConfig {
  return {
    protoSource: PROTO_SOURCE,
    protoSourceType: "inline",
    packageName: "testpkg",
    serviceName: "TestService",
    allowedMethods: ["GetProducts"],
    useTls: false,
    ...overrides,
  };
}

describe("grpcCall — real local gRPC server", () => {
  it("throws GrpcMethodNotAllowedError for a method not on the allow-list, without contacting the server", async () => {
    await expect(
      grpcCall({ target: `127.0.0.1:${port}`, methodName: "AlwaysFails", request: {}, credential: { authMethod: "NONE" }, grpcConfig: grpcConfig(), timeoutMs: 2000 })
    ).rejects.toThrow(GrpcMethodNotAllowedError);
  });

  it("invokes a real unary RPC end-to-end and returns the response", async () => {
    const result = await grpcCall({ target: `127.0.0.1:${port}`, methodName: "GetProducts", request: { category: "books" }, credential: { authMethod: "NONE" }, grpcConfig: grpcConfig(), timeoutMs: 2000 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ names: ["product-in-books"] });
  });

  it("surfaces a real server-side error as ok:false", async () => {
    const result = await grpcCall({ target: `127.0.0.1:${port}`, methodName: "AlwaysFails", request: {}, credential: { authMethod: "NONE" }, grpcConfig: grpcConfig({ allowedMethods: ["AlwaysFails"] }), timeoutMs: 2000 });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/simulated failure/);
  });

  it("returns ok:false for an unreachable target rather than hanging", async () => {
    const result = await grpcCall({ target: "127.0.0.1:1", methodName: "GetProducts", request: {}, credential: { authMethod: "NONE" }, grpcConfig: grpcConfig(), timeoutMs: 1500 });
    expect(result.ok).toBe(false);
  }, 10_000);
});

describe("materializeProtoFile", () => {
  it("writes inline source to a real temp file and cleans it up", async () => {
    const { filePath, cleanup } = await materializeProtoFile(grpcConfig({ protoSourceType: "inline", protoSource: 'syntax = "proto3";' }));
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe('syntax = "proto3";');
    await cleanup();
    await expect(fs.readFile(filePath, "utf-8")).rejects.toThrow();
  });

  it("passes a file-mode path through unchanged with a no-op cleanup", async () => {
    const { filePath, cleanup } = await materializeProtoFile(grpcConfig({ protoSourceType: "file", protoSource: "/config/my-service.proto" }));
    expect(filePath).toBe("/config/my-service.proto");
    await expect(cleanup()).resolves.toBeUndefined();
  });
});

describe("resolvePackagePath", () => {
  it("walks a dotted path through a nested object", () => {
    const root = { a: { b: { c: "found" } } } as unknown as grpc.GrpcObject;
    expect(resolvePackagePath(root, "a.b.c")).toBe("found");
  });

  it("returns undefined for a path that doesn't exist", () => {
    const root = { a: {} } as unknown as grpc.GrpcObject;
    expect(resolvePackagePath(root, "a.b.c")).toBeUndefined();
  });
});
