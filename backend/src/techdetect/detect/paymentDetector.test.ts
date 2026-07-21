import { describe, it, expect } from "vitest";
import { detectPaymentGateways } from "./paymentDetector";
import { buildSignals } from "../testFixtures";
import { collectSignals } from "../signals/signalCollector";

function namesOf(result: ReturnType<typeof detectPaymentGateways>): string[] {
  return result.map((c) => c.name);
}

describe("detectPaymentGateways — synthetic signatures", () => {
  it("detects Stripe from its SDK script and Stripe(pk_...) call", () => {
    const signals = buildSignals({ html: '<script src="https://js.stripe.com/v3/"></script><script>const stripe = Stripe("pk_live_abc123");</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("Stripe");
  });

  it("detects Razorpay from its checkout script and constructor call", () => {
    const signals = buildSignals({ html: '<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>const rzp = new Razorpay({});</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("Razorpay");
  });

  it("detects PayPal from its SDK script and Buttons call", () => {
    const signals = buildSignals({ html: '<script src="https://www.paypal.com/sdk/js?client-id=abc"></script><script>paypal.Buttons().render("#x");</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("PayPal");
  });

  it("detects Square from its SDK script and payments() call", () => {
    const signals = buildSignals({ html: '<script src="https://web.squarecdn.com/v1/square.js"></script><script>Square.payments("app-id", "loc-id");</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("Square");
  });

  it("detects Authorize.Net from Accept.js and dispatchData call", () => {
    const signals = buildSignals({ html: '<script src="https://js.authorize.net/v1/Accept.js"></script><script>Accept.dispatchData(data, cb);</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("Authorize.Net");
  });

  it("detects PayU from its checkout domain and bolt.payu call", () => {
    const signals = buildSignals({ html: '<script src="https://checkout.payu.in/bolt.js"></script><script>bolt.payu({});</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("PayU");
  });

  it("detects PhonePe from its SDK domain and transact call", () => {
    const signals = buildSignals({ html: '<script src="https://mercury.phonepe.com/web/bundle/checkout.js"></script><script>PhonePeCheckout.transact({});</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("PhonePe");
  });

  it("detects Cashfree from its SDK script and constructor call", () => {
    const signals = buildSignals({ html: '<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script><script>const cf = Cashfree({mode: "sandbox"});</script>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("Cashfree");
  });

  it("detects CCAvenue from its checkout domain", () => {
    const signals = buildSignals({ html: '<form action="https://secure.ccavenue.com/transaction/transaction.do"></form>' });
    expect(namesOf(detectPaymentGateways(signals))).toContain("CCAvenue");
  });

  it("falls back to Custom Payment when a checkout-looking form exists but no gateway SDK matches", () => {
    const signals = buildSignals({ forms: [{ action: "/checkout/submit", method: "post", id: null, className: null, fields: [] }] });
    const result = detectPaymentGateways(signals);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Custom Payment");
  });

  it("returns no candidates when there is no payment signal and no checkout form", () => {
    expect(detectPaymentGateways(buildSignals())).toEqual([]);
  });

  it("detects multiple independent gateways on the same page", () => {
    const signals = buildSignals({
      html: '<script src="https://js.stripe.com/v3/"></script><script src="https://www.paypal.com/sdk/js?client-id=abc"></script>',
    });
    const names = namesOf(detectPaymentGateways(signals));
    expect(names).toContain("Stripe");
    expect(names).toContain("PayPal");
  });
});

describe("detectPaymentGateways — real websites", () => {
  it("never crashes against a real, live homepage even when no payment SDK is present there", async () => {
    const signals = await collectSignals("https://example.com");
    expect(() => detectPaymentGateways(signals)).not.toThrow();
  }, 30000);
});
