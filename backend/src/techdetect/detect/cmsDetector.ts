import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack, metaGeneratorContent, cookieNamesHaystack, allHeadersHaystack, wellKnownPathFound } from "./signalUtils";

/**
 * Detects which CMS/e-commerce platform a site runs on, combining HTML
 * markup, generator meta tags, cookies, response headers, and well-known
 * path probes — never a single signal alone. WordPress and WooCommerce
 * are reported as separate candidates (a WooCommerce store's `cms` result
 * legitimately includes both: WordPress is the CMS, WooCommerce is the
 * commerce layer on top of it).
 */
export function detectCms(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const generator = metaGeneratorContent(signals);
  const cookies = cookieNamesHaystack(signals);
  const headers = allHeadersHaystack(signals);
  const builder = new CandidateBuilder();

  // WordPress
  if (/\/wp-content\//i.test(html)) builder.add("WordPress", "/wp-content/ path referenced in HTML", 0.85);
  if (/\/wp-includes\//i.test(html)) builder.add("WordPress", "/wp-includes/ path referenced in HTML", 0.85);
  if (/\bwp-json\b/i.test(html)) builder.add("WordPress", "wp-json REST API reference found", 0.6);
  if (/wordpress/i.test(generator)) builder.add("WordPress", `generator meta tag: "${generator}"`, 0.95);
  if (/wp-settings-|wordpress_logged_in_/i.test(cookies)) builder.add("WordPress", "WordPress session cookie present", 0.9);
  if (wellKnownPathFound(signals, "/wp-login.php")) builder.add("WordPress", "/wp-login.php is publicly reachable", 0.8);
  if (wellKnownPathFound(signals, "/wp-json/")) builder.add("WordPress", "/wp-json/ REST API endpoint is reachable", 0.75);
  // xmlrpc.php/readme.html/administrator//user-login weighted low
  // deliberately: real testing against github.com found `/administrator/`
  // and `/readme.html` both return 200 there (GitHub resolves arbitrary
  // top-level path segments as user/org lookups — "administrator" happens
  // to be a real, coincidental match), producing false-positive
  // Joomla/WordPress candidates from a single generic path-existence check
  // alone. These paths still contribute when combined with a real signal
  // (a generator tag, a session cookie), just not enough alone to imply
  // meaningful confidence on their own.
  if (wellKnownPathFound(signals, "/xmlrpc.php")) builder.add("WordPress", "/xmlrpc.php is reachable", 0.3);
  if (wellKnownPathFound(signals, "/readme.html")) builder.add("WordPress", "/readme.html (WP core readme) is reachable", 0.2);

  // WooCommerce (on top of WordPress) — deliberately more specific than a
  // bare "woocommerce" substring match: a WordPress *blog* that merely
  // writes about WooCommerce (an article, an outbound link) would
  // otherwise false-positive as a WooCommerce *store*. Real testing
  // against wptavern.com (a WordPress news site, not a store) caught
  // exactly this — matching actual plugin paths / markup conventions
  // instead of incidental prose.
  if (/\/plugins\/woocommerce\/|class="[^"]*\bwoocommerce\b|id="[^"]*\bwoocommerce\b|\bwc-ajax\b|\bwc_add_to_cart_params\b/i.test(html)) {
    builder.add("WooCommerce", "WooCommerce plugin path or markup convention found", 0.8);
  }
  if (/woocommerce_cart_hash|woocommerce_items_in_cart/i.test(cookies)) builder.add("WooCommerce", "WooCommerce cart cookie present", 0.9);
  if (/woocommerce/i.test(generator)) builder.add("WooCommerce", `generator meta tag mentions WooCommerce: "${generator}"`, 0.9);

  // Shopify
  if (/cdn\.shopify\.com/i.test(html)) builder.add("Shopify", "cdn.shopify.com asset URL found", 0.9);
  if (/Shopify\.(theme|shop)/i.test(html)) builder.add("Shopify", "Shopify.theme/Shopify.shop JS object referenced", 0.9);
  if (/shopify-digital-wallet/i.test(html)) builder.add("Shopify", "shopify-digital-wallet meta tag found", 0.85);
  if (/_shopify_s|_shopify_y|cart_currency/i.test(cookies)) builder.add("Shopify", "Shopify storefront cookie present", 0.85);
  if (/x-shopid|x-shopify-stage|x-sorting-hat/i.test(headers)) builder.add("Shopify", "Shopify-specific response header present", 0.95);
  if (wellKnownPathFound(signals, "/products.json")) builder.add("Shopify", "/products.json storefront API is reachable", 0.8);

  // Magento
  if (/Mage\.Cookies|data-mage-init/i.test(html)) builder.add("Magento", "Magento JS object/data attribute found", 0.85);
  if (/\/skin\/frontend\/|\/static\/frontend\//i.test(html)) builder.add("Magento", "Magento frontend asset path found", 0.75);
  if (/magento/i.test(generator)) builder.add("Magento", `generator meta tag: "${generator}"`, 0.9);
  if (/x-magento/i.test(headers)) builder.add("Magento", "X-Magento-* response header present", 0.9);

  // OpenCart
  if (/index\.php\?route=/i.test(html)) builder.add("OpenCart", "OpenCart-style route= URL pattern found", 0.6);
  if (/catalog\/view\/(theme|javascript)\//i.test(html)) builder.add("OpenCart", "catalog/view/ asset path found", 0.8);
  if (/\bOCSESSID\b/i.test(cookies)) builder.add("OpenCart", "OCSESSID session cookie present", 0.9);

  // PrestaShop
  if (/prestashop/i.test(html)) builder.add("PrestaShop", "\"prestashop\" referenced in HTML/assets", 0.75);
  if (/prestashop/i.test(generator)) builder.add("PrestaShop", `generator meta tag: "${generator}"`, 0.9);
  if (/PrestaShop-/i.test(cookies)) builder.add("PrestaShop", "PrestaShop session cookie present", 0.9);

  // Drupal
  if (/drupal/i.test(generator)) builder.add("Drupal", `generator meta tag: "${generator}"`, 0.95);
  if (/Drupal\.settings|drupal\.js/i.test(html)) builder.add("Drupal", "Drupal.settings JS object referenced", 0.85);
  if (/\/sites\/(default|all)\//i.test(html)) builder.add("Drupal", "/sites/default|all/ path referenced", 0.7);
  if (/^SESS[a-f0-9]{32}=/im.test(cookies) || /\bSESS[a-f0-9]{10,}\b/i.test(cookies)) builder.add("Drupal", "Drupal-style SESS* session cookie present", 0.7);
  if (/x-generator:\s*drupal/i.test(headers)) builder.add("Drupal", "X-Generator response header mentions Drupal", 0.95);
  if (wellKnownPathFound(signals, "/user/login")) builder.add("Drupal", "/user/login is reachable", 0.2);

  // Joomla
  if (/joomla/i.test(generator)) builder.add("Joomla", `generator meta tag: "${generator}"`, 0.95);
  if (/\/media\/jui\/|Joomla\./i.test(html)) builder.add("Joomla", "Joomla core asset path or JS object found", 0.8);
  if (/joomla_user_state/i.test(cookies)) builder.add("Joomla", "Joomla session cookie present", 0.9);
  if (wellKnownPathFound(signals, "/administrator/")) builder.add("Joomla", "/administrator/ is reachable", 0.2);

  // Ghost
  if (/ghost\s*[\d.]*/i.test(generator) && /ghost/i.test(generator)) builder.add("Ghost", `generator meta tag: "${generator}"`, 0.95);
  if (/\/ghost\/api\//i.test(html)) builder.add("Ghost", "/ghost/api/ reference found", 0.85);
  if (/casper.*theme|ghost-sdk/i.test(html)) builder.add("Ghost", "Ghost default theme/SDK reference found", 0.6);

  // Blogger
  if (/\.blogspot\.com|blogger\.com/i.test(html)) builder.add("Blogger", "blogspot.com/blogger.com URL referenced", 0.85);
  if (/blogger/i.test(generator)) builder.add("Blogger", `generator meta tag: "${generator}"`, 0.95);

  // Wix
  if (/wixstatic\.com|static\.parastorage\.com/i.test(html)) builder.add("Wix", "Wix static asset domain referenced", 0.85);
  if (/wix\.com/i.test(generator)) builder.add("Wix", `generator meta tag: "${generator}"`, 0.95);
  if (/x-wix-request-id/i.test(headers)) builder.add("Wix", "X-Wix-Request-Id response header present", 0.95);

  // Squarespace
  if (/static\d*\.squarespace\.com/i.test(html)) builder.add("Squarespace", "Squarespace static asset domain referenced", 0.85);
  if (/squarespace/i.test(generator)) builder.add("Squarespace", `generator meta tag: "${generator}"`, 0.95);
  if (/squarespace/i.test(headers)) builder.add("Squarespace", "Squarespace referenced in response headers", 0.8);

  // Webflow
  if (/assets\.website-files\.com/i.test(html)) builder.add("Webflow", "Webflow asset domain (website-files.com) referenced", 0.85);
  if (/data-wf-site|data-wf-page/i.test(html)) builder.add("Webflow", "data-wf-site/data-wf-page attribute found", 0.9);
  if (/webflow/i.test(generator)) builder.add("Webflow", `generator meta tag: "${generator}"`, 0.95);

  const candidates = builder.build();

  // Nothing matched at all, but the page loaded real HTML — report a
  // low-confidence "Custom CMS" candidate rather than an empty result, so
  // the report generator has something to say about every site instead of
  // silently omitting the category.
  if (candidates.length === 0 && signals.html.trim().length > 0) {
    return [{ name: "Custom CMS", matches: [{ signal: "No known CMS/e-commerce platform signature matched", weight: 0.3 }] }];
  }

  return candidates;
}
