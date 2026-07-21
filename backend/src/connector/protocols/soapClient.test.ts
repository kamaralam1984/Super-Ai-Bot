import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSoapEnvelope, soapCall, SoapActionNotAllowedError } from "./soapClient";
import { DEFAULT_CONNECTOR_CONFIG } from "../types";
import type { SoapConnectionConfig } from "../types";

const safeFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../scanner/http/safeFetch", () => ({ safeFetch: safeFetchMock }));

beforeEach(() => {
  safeFetchMock.mockReset();
});

describe("buildSoapEnvelope", () => {
  it("builds a well-formed SOAP 1.1 envelope with no parameters", () => {
    const envelope = buildSoapEnvelope("1.1", "GetProducts", "urn:hospital:patients");
    expect(envelope).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetProducts xmlns="urn:hospital:patients"></GetProducts></soap:Body></soap:Envelope>'
    );
  });

  it("uses the SOAP 1.2 envelope namespace", () => {
    const envelope = buildSoapEnvelope("1.2", "GetProducts", "urn:example");
    expect(envelope).toContain('xmlns:soap="http://www.w3.org/2003/05/soap-envelope"');
  });

  it("serializes flat parameters as child elements", () => {
    const envelope = buildSoapEnvelope("1.1", "GetProduct", "urn:example", { ProductId: "123", Category: "Books" });
    expect(envelope).toContain("<ProductId>123</ProductId>");
    expect(envelope).toContain("<Category>Books</Category>");
  });

  it("serializes nested object parameters", () => {
    const envelope = buildSoapEnvelope("1.1", "Search", "urn:example", { Filter: { MinPrice: 10, MaxPrice: 100 } });
    expect(envelope).toContain("<Filter><MinPrice>10</MinPrice><MaxPrice>100</MaxPrice></Filter>");
  });

  it("serializes array parameters as repeated elements", () => {
    const envelope = buildSoapEnvelope("1.1", "Search", "urn:example", { Tag: ["a", "b"] });
    expect(envelope).toContain("<Tag>a</Tag><Tag>b</Tag>");
  });

  it("escapes XML-significant characters in parameter values", () => {
    const envelope = buildSoapEnvelope("1.1", "Search", "urn:example", { Query: `<script>&"'` });
    expect(envelope).toContain("<Query>&lt;script&gt;&amp;&quot;&apos;</Query>");
  });

  it("self-closes a null/undefined parameter", () => {
    const envelope = buildSoapEnvelope("1.1", "Search", "urn:example", { OptionalField: null });
    expect(envelope).toContain("<OptionalField/>");
  });
});

const soapConfig: SoapConnectionConfig = { soapVersion: "1.1", targetNamespace: "urn:example", allowedActions: ["GetProducts"] };

function xmlResponse(body: string, statusCode = 200) {
  return { ok: statusCode < 300, statusCode, body: Buffer.from(body), headers: {}, finalUrl: "https://example.com/soap" };
}

describe("soapCall", () => {
  it("throws SoapActionNotAllowedError for an action not on the allow-list", async () => {
    await expect(
      soapCall({ connectorId: "c1", baseUrl: "https://example.com", path: "/soap", action: "DeleteProduct", operationName: "DeleteProduct", credential: { authMethod: "NONE" }, config: DEFAULT_CONNECTOR_CONFIG, soapConfig })
    ).rejects.toThrow(SoapActionNotAllowedError);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("sends SOAP 1.1 headers (SOAPAction header, text/xml content type)", async () => {
    safeFetchMock.mockResolvedValue(xmlResponse('<soap:Envelope><soap:Body><GetProductsResponse><Id>1</Id></GetProductsResponse></soap:Body></soap:Envelope>'));
    await soapCall({ connectorId: "c1", baseUrl: "https://example.com", path: "/soap", action: "GetProducts", operationName: "GetProducts", credential: { authMethod: "NONE" }, config: DEFAULT_CONNECTOR_CONFIG, soapConfig });
    const call = safeFetchMock.mock.calls[0];
    expect(call[1].headers.SOAPAction).toBe('"GetProducts"');
    expect(call[1].headers["Content-Type"]).toBe("text/xml; charset=utf-8");
  });

  it("sends SOAP 1.2 headers (action embedded in content-type, no SOAPAction header)", async () => {
    safeFetchMock.mockResolvedValue(xmlResponse('<soap:Envelope><soap:Body><GetProductsResponse/></soap:Body></soap:Envelope>'));
    const soap12Config: SoapConnectionConfig = { ...soapConfig, soapVersion: "1.2" };
    await soapCall({ connectorId: "c1", baseUrl: "https://example.com", path: "/soap", action: "GetProducts", operationName: "GetProducts", credential: { authMethod: "NONE" }, config: DEFAULT_CONNECTOR_CONFIG, soapConfig: soap12Config });
    const call = safeFetchMock.mock.calls[0];
    expect(call[1].headers["Content-Type"]).toContain('action="GetProducts"');
    expect(call[1].headers.SOAPAction).toBeUndefined();
  });

  it("parses a successful response body", async () => {
    safeFetchMock.mockResolvedValue(xmlResponse('<soap:Envelope><soap:Body><GetProductsResponse><Product><Id>1</Id><Name>Widget</Name></Product></GetProductsResponse></soap:Body></soap:Envelope>'));
    const result = await soapCall({ connectorId: "c1", baseUrl: "https://example.com", path: "/soap", action: "GetProducts", operationName: "GetProducts", credential: { authMethod: "NONE" }, config: DEFAULT_CONNECTOR_CONFIG, soapConfig });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ GetProductsResponse: { Product: { Id: 1, Name: "Widget" } } });
  });

  it("detects and extracts a SOAP Fault", async () => {
    safeFetchMock.mockResolvedValue(xmlResponse('<soap:Envelope><soap:Body><soap:Fault><faultcode>Server</faultcode><faultstring>Invalid request</faultstring></soap:Fault></soap:Body></soap:Envelope>', 500));
    const result = await soapCall({ connectorId: "c1", baseUrl: "https://example.com", path: "/soap", action: "GetProducts", operationName: "GetProducts", credential: { authMethod: "NONE" }, config: DEFAULT_CONNECTOR_CONFIG, soapConfig });
    expect(result.ok).toBe(false);
    expect(result.faultMessage).toBe("Invalid request");
  });

  it("returns ok:false with a clear message when the response isn't valid XML", async () => {
    safeFetchMock.mockResolvedValue(xmlResponse("<<not xml"));
    const result = await soapCall({ connectorId: "c1", baseUrl: "https://example.com", path: "/soap", action: "GetProducts", operationName: "GetProducts", credential: { authMethod: "NONE" }, config: DEFAULT_CONNECTOR_CONFIG, soapConfig });
    expect(result.ok).toBe(false);
    expect(result.faultMessage).toMatch(/not valid XML/);
  });
});
