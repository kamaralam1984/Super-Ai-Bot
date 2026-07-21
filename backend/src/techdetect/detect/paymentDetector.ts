import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack } from "./signalUtils";

/** Payment gateway detection from checkout SDK scripts and their distinctive initialization calls. */
export function detectPaymentGateways(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const builder = new CandidateBuilder();

  if (/js\.stripe\.com\/v3/i.test(html)) builder.add("Stripe", "js.stripe.com/v3 SDK script referenced", 0.9);
  if (/\bStripe\s*\(\s*['"]pk_/i.test(html)) builder.add("Stripe", "Stripe(publishable_key) initialization call found", 0.85);

  if (/checkout\.razorpay\.com/i.test(html)) builder.add("Razorpay", "checkout.razorpay.com SDK script referenced", 0.9);
  if (/new\s+Razorpay\s*\(/i.test(html)) builder.add("Razorpay", "new Razorpay(...) initialization call found", 0.85);

  if (/www\.paypal\.com\/sdk\/js|paypalobjects\.com/i.test(html)) builder.add("PayPal", "PayPal SDK script/asset referenced", 0.85);
  if (/paypal\.Buttons\s*\(/i.test(html)) builder.add("PayPal", "paypal.Buttons(...) call found", 0.85);

  if (/js\.squareup\.com|web\.squarecdn\.com/i.test(html)) builder.add("Square", "Square payment SDK script referenced", 0.9);
  if (/Square\.payments\s*\(/i.test(html)) builder.add("Square", "Square.payments(...) call found", 0.85);

  if (/js\.authorize\.net/i.test(html)) builder.add("Authorize.Net", "Authorize.Net Accept.js SDK referenced", 0.9);
  if (/Accept\.dispatchData\s*\(/i.test(html)) builder.add("Authorize.Net", "Accept.dispatchData(...) call found", 0.85);

  if (/secure\.payu\.(com|in)|checkout\.payu\.in/i.test(html)) builder.add("PayU", "PayU checkout domain referenced", 0.85);
  if (/bolt\.payu\s*\(/i.test(html)) builder.add("PayU", "bolt.payu(...) call found", 0.8);

  if (/mercury\.phonepe\.com/i.test(html)) builder.add("PhonePe", "PhonePe SDK domain referenced", 0.9);
  if (/PhonePeCheckout\.transact\s*\(/i.test(html)) builder.add("PhonePe", "PhonePeCheckout.transact(...) call found", 0.85);

  if (/sdk\.cashfree\.com/i.test(html)) builder.add("Cashfree", "Cashfree SDK script referenced", 0.9);
  if (/\bCashfree\s*\(\s*\{/i.test(html)) builder.add("Cashfree", "Cashfree({...}) initialization call found", 0.8);

  if (/secure\.ccavenue\.com/i.test(html)) builder.add("CCAvenue", "CCAvenue checkout domain referenced", 0.9);

  const candidates = builder.build();
  if (candidates.length > 0) return candidates;

  const hasCheckoutForm = signals.forms.some((f) => /pay|checkout|billing|cart/i.test(f.action ?? "") || /pay|checkout/i.test(f.id ?? "") || /pay|checkout/i.test(f.className ?? ""));
  if (hasCheckoutForm) {
    return [{ name: "Custom Payment", matches: [{ signal: "A checkout/payment-looking <form> exists, but no known gateway SDK signature matched", weight: 0.3 }] }];
  }

  return [];
}
