// SOAP Client — builds a SOAP 1.1/1.2 envelope, POSTs it through
// `safeFetch` (the same SSRF-guarded entry point every other connector
// call uses), and parses the XML response via `fast-xml-parser` (already
// a dependency — Phase 2's document pipeline uses it for XML documents).
// The most common real-world reason a chatbot needs this: legacy
// enterprise systems (hospital/school/hotel ERPs especially) are
// frequently SOAP-only.
//
// SOAP has no protocol-level way to distinguish a read call from a write
// call — unlike REST's GET/HEAD restriction or GraphQL's mutation-keyword
// guard, every SOAP operation is just a POST with an arbitrary
// `<soap:Body>` payload. The administrator-supplied `allowedActions`
// allow-list (`SoapConnectionConfig`, set once during connector setup) IS
// this product's least-privilege enforcement for SOAP: an action not on
// the list is refused before any request is sent, full stop — this is not
// a convenience filter, it is the safety mechanism.

import { XMLParser } from "fast-xml-parser";
import { safeFetch } from "../../scanner/http/safeFetch";
import { resolveAuth } from "../auth/authManager";
import type { ConnectorRuntimeConfig, RawCredentialInput, SoapConnectionConfig } from "../types";

export class SoapActionNotAllowedError extends Error {
  constructor(action: string, allowed: string[]) {
    super(`SOAP action "${action}" is not on this connector's allowed-actions list (${allowed.length > 0 ? allowed.join(", ") : "none configured"}) — refusing to send it.`);
    this.name = "SoapActionNotAllowedError";
  }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Recursively serializes a plain JS value into XML child elements — deliberately hand-rolled rather than a builder library call, so the exact output shape is predictable and independently testable without relying on a third-party builder's own conventions for arrays/nesting/root elements. */
function serializeXmlValue(tagName: string, value: unknown): string {
  if (value === null || value === undefined) return `<${tagName}/>`;
  if (Array.isArray(value)) return value.map((item) => serializeXmlValue(tagName, item)).join("");
  if (typeof value === "object") return `<${tagName}>${serializeXmlParams(value as Record<string, unknown>)}</${tagName}>`;
  return `<${tagName}>${escapeXml(String(value))}</${tagName}>`;
}

function serializeXmlParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([key, value]) => serializeXmlValue(key, value))
    .join("");
}

export function buildSoapEnvelope(soapVersion: "1.1" | "1.2", operationName: string, targetNamespace: string, parameters?: Record<string, unknown>): string {
  const envelopeNamespace = soapVersion === "1.2" ? "http://www.w3.org/2003/05/soap-envelope" : "http://schemas.xmlsoap.org/soap/envelope/";
  const paramsXml = parameters ? serializeXmlParams(parameters) : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="${envelopeNamespace}">` +
    `<soap:Body>` +
    `<${operationName} xmlns="${escapeXml(targetNamespace)}">${paramsXml}</${operationName}>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

export interface SoapCallOptions {
  connectorId: string;
  baseUrl: string;
  path: string;
  action: string;
  operationName: string;
  parameters?: Record<string, unknown>;
  credential: RawCredentialInput;
  config: ConnectorRuntimeConfig;
  soapConfig: SoapConnectionConfig;
}

export interface SoapCallResult {
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  data?: unknown;
  faultMessage?: string;
  raw: string;
}

/** Invokes one SOAP operation. Throws `SoapActionNotAllowedError` (not a soft `ok:false`) when the action isn't allow-listed — a caller must never be able to silently proceed past a least-privilege violation the way a normal failed-call result could be misread. */
export async function soapCall(options: SoapCallOptions): Promise<SoapCallResult> {
  if (!options.soapConfig.allowedActions.includes(options.action)) {
    throw new SoapActionNotAllowedError(options.action, options.soapConfig.allowedActions);
  }

  const url = new URL(options.path, options.baseUrl).toString();
  const auth = resolveAuth(options.credential, "POST", options.path);
  const envelope = buildSoapEnvelope(options.soapConfig.soapVersion, options.operationName, options.soapConfig.targetNamespace, options.parameters);

  const headers: Record<string, string> = { ...auth.headers };
  if (options.soapConfig.soapVersion === "1.2") {
    headers["Content-Type"] = `application/soap+xml; charset=utf-8; action="${options.action}"`;
  } else {
    headers["Content-Type"] = "text/xml; charset=utf-8";
    headers.SOAPAction = `"${options.action}"`;
  }

  const startedAt = Date.now();
  const response = await safeFetch(url, {
    method: "POST",
    headers,
    body: envelope,
    timeoutMs: options.config.timeoutMs,
    maxRedirects: options.config.maxRedirects,
  });
  const latencyMs = Date.now() - startedAt;
  const raw = response.body.toString("utf-8");

  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, statusCode: response.statusCode, latencyMs, faultMessage: "Response was not valid XML.", raw };
  }

  const envelopeRoot = parsed.Envelope as Record<string, unknown> | undefined;
  const body = envelopeRoot?.Body as Record<string, unknown> | undefined;
  const fault = body?.Fault as Record<string, unknown> | undefined;

  if (fault) {
    const rawMessage = fault.faultstring ?? (fault.Reason as Record<string, unknown> | undefined)?.Text ?? fault;
    return { ok: false, statusCode: response.statusCode, latencyMs, faultMessage: typeof rawMessage === "string" ? rawMessage : JSON.stringify(rawMessage), raw };
  }

  return { ok: response.ok && response.statusCode < 500, statusCode: response.statusCode, latencyMs, data: body, raw };
}
