// gRPC Client — loads a .proto definition (inline source, or a file the
// administrator placed under this installation's config/ directory) via
// `@grpc/proto-loader`, and invokes one unary RPC method dynamically.
//
// Deliberately NOT server-reflection-based auto-discovery. gRPC has a
// standard reflection service (`grpc.reflection.v1alpha.ServerReflection`),
// but (a) many production gRPC servers disable it for exactly the reason
// this product cares about — it's an information-disclosure surface an
// operator may not want exposed — and (b) dynamically decoding
// reflection-returned `FileDescriptorProto` bytes into invokable message
// types has no way to be verified against a real server in this
// environment. Requiring the administrator to supply the .proto (the same
// requirement most API gateways and tools like grpcurl impose when
// reflection isn't available) is the honest, testable, actually-reliable
// path — a documented scope boundary, not a missing feature pretending to
// be complete.
//
// Same least-privilege mechanism as protocols/soapClient.ts: gRPC has no
// protocol-level way to distinguish a read call from a write call, so the
// administrator-supplied `allowedMethods` allow-list *is* the enforcement.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { GrpcConnectionConfig, RawCredentialInput } from "../types";

export class GrpcMethodNotAllowedError extends Error {
  constructor(method: string, allowed: string[]) {
    super(`gRPC method "${method}" is not on this connector's allowed-methods list (${allowed.length > 0 ? allowed.join(", ") : "none configured"}) — refusing to invoke it.`);
    this.name = "GrpcMethodNotAllowedError";
  }
}

interface MaterializedProto {
  filePath: string;
  cleanup: () => Promise<void>;
}

/** "file" mode uses the administrator-supplied path as-is (already validated to live under this installation's config/ directory at connector-setup time — that validation is a routes/orchestrator concern, not this client's). "inline" mode writes the supplied source to a uniquely-named temp file, since `@grpc/proto-loader` only loads from the filesystem — and removes it in every case via the returned `cleanup()`. */
export async function materializeProtoFile(grpcConfig: GrpcConnectionConfig): Promise<MaterializedProto> {
  if (grpcConfig.protoSourceType === "file") {
    return { filePath: grpcConfig.protoSource, cleanup: async () => undefined };
  }
  const tempPath = path.join(os.tmpdir(), `kvl-grpc-${crypto.randomBytes(8).toString("hex")}.proto`);
  await fs.writeFile(tempPath, grpcConfig.protoSource, "utf-8");
  return { filePath: tempPath, cleanup: () => fs.unlink(tempPath).catch(() => undefined) };
}

/** Walks a dotted package path (e.g. "hospital.v1.PatientService") through @grpc/grpc-js's loaded package object. Exported as a pure helper, independently testable without loading any real proto. */
export function resolvePackagePath(root: grpc.GrpcObject, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((acc, segment) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[segment] : undefined), root);
}

function resolveChannelCredentials(grpcConfig: GrpcConnectionConfig, credential: RawCredentialInput): grpc.ChannelCredentials {
  if (!grpcConfig.useTls) return grpc.credentials.createInsecure();

  if (credential.authMethod === "MTLS" && credential.mtls) {
    return grpc.credentials.createSsl(credential.mtls.caCertPem ? Buffer.from(credential.mtls.caCertPem) : null, Buffer.from(credential.mtls.clientKeyPem), Buffer.from(credential.mtls.clientCertPem));
  }

  const tlsCredentials = grpc.credentials.createSsl();
  if (credential.authMethod === "BEARER_TOKEN" && credential.bearerToken) {
    const bearerToken = credential.bearerToken;
    const callCredentials = grpc.credentials.createFromMetadataGenerator((_params, callback) => {
      const metadata = new grpc.Metadata();
      metadata.add("authorization", `Bearer ${bearerToken}`);
      callback(null, metadata);
    });
    return grpc.credentials.combineChannelCredentials(tlsCredentials, callCredentials);
  }

  return tlsCredentials;
}

export interface GrpcCallOptions {
  /** "host:port" — gRPC targets are not URLs with a scheme. */
  target: string;
  methodName: string;
  request: Record<string, unknown>;
  credential: RawCredentialInput;
  grpcConfig: GrpcConnectionConfig;
  timeoutMs: number;
}

export interface GrpcCallResult {
  ok: boolean;
  data?: unknown;
  errorMessage?: string;
  latencyMs: number;
}

/** Invokes one unary RPC method. Throws `GrpcMethodNotAllowedError` (not a soft `ok:false`) for a method not on the allow-list, before the .proto is even loaded or any connection attempted — same "a caller must never be able to misread a least-privilege refusal as an ordinary failed call" reasoning as soapClient.ts. */
export async function grpcCall(options: GrpcCallOptions): Promise<GrpcCallResult> {
  if (!options.grpcConfig.allowedMethods.includes(options.methodName)) {
    throw new GrpcMethodNotAllowedError(options.methodName, options.grpcConfig.allowedMethods);
  }

  const startedAt = Date.now();
  const { filePath, cleanup } = await materializeProtoFile(options.grpcConfig);
  let client: grpc.Client | undefined;

  try {
    const packageDefinition = await protoLoader.load(filePath, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
    const grpcObject = grpc.loadPackageDefinition(packageDefinition);
    const serviceCtor = resolvePackagePath(grpcObject, `${options.grpcConfig.packageName}.${options.grpcConfig.serviceName}`);
    if (typeof serviceCtor !== "function") {
      throw new Error(`Service "${options.grpcConfig.packageName}.${options.grpcConfig.serviceName}" was not found in the supplied .proto definition.`);
    }

    const credentials = resolveChannelCredentials(options.grpcConfig, options.credential);
    const ServiceClient = serviceCtor as grpc.ServiceClientConstructor;
    client = new ServiceClient(options.target, credentials);

    const data = await new Promise<unknown>((resolve, reject) => {
      const method = (client as unknown as Record<string, unknown>)[options.methodName];
      if (typeof method !== "function") {
        reject(new Error(`Method "${options.methodName}" was not found on service "${options.grpcConfig.serviceName}".`));
        return;
      }
      const deadline = Date.now() + options.timeoutMs;
      (method as (...args: unknown[]) => void).call(client, options.request, new grpc.Metadata(), { deadline }, (err: grpc.ServiceError | null, response: unknown) => {
        if (err) reject(err);
        else resolve(response);
      });
    });

    return { ok: true, data, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - startedAt };
  } finally {
    client?.close();
    await cleanup();
  }
}
