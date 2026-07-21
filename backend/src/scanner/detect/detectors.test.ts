import { describe, it, expect } from "vitest";
import { extractStructuredData } from "../parse/structuredData";
import { detectProducts } from "./productDetector";
import { detectServices } from "./serviceDetector";
import { detectFaqs } from "./faqDetector";

describe("detectProducts", () => {
  it("extracts a product from schema.org Product JSON-LD", () => {
    const html = `<script type="application/ld+json">
      {
        "@context": "https://schema.org", "@type": "Product",
        "name": "Wireless Mouse", "description": "A great mouse", "sku": "WM-100",
        "brand": { "@type": "Brand", "name": "Acme" },
        "image": ["https://acme.com/mouse.jpg"],
        "offers": { "price": "29.99", "priceCurrency": "USD", "availability": "https://schema.org/InStock" },
        "aggregateRating": { "ratingValue": "4.5", "reviewCount": "120" }
      }
    </script>`;
    const products = detectProducts(html, extractStructuredData(html));
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      name: "Wireless Mouse",
      sku: "WM-100",
      brand: "Acme",
      price: "29.99",
      currency: "USD",
      stockStatus: "InStock",
      rating: 4.5,
      reviewCount: 120,
      source: "structured_data",
    });
  });

  it("falls back to WooCommerce-style heuristic markup when no structured data exists", () => {
    const html = `<div class="product">
      <h1 class="product_title">Ceramic Mug</h1>
      <span class="price"><span class="amount">$14.00</span></span>
      <div class="woocommerce-product-details__short-description"><p>A sturdy ceramic mug.</p></div>
      <img src="/mug.jpg">
    </div>`;
    const products = detectProducts(html, extractStructuredData(html));
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Ceramic Mug");
    expect(products[0].price).toContain("14.00");
    expect(products[0].source).toBe("heuristic");
  });

  it("falls back to whole-document scan when the product has no recognized container class (regression: real site used '.product_main', unmatched by the original selector list)", () => {
    const html = `<html><body>
      <div class="col-sm-6 product_main">
        <h1>A Light in the Attic</h1>
        <p class="price_color">£51.77</p>
        <p class="instock availability">In stock (22 available)</p>
      </div>
    </body></html>`;
    const products = detectProducts(html, extractStructuredData(html));
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("A Light in the Attic");
    expect(products[0].price).toBe("£51.77");
    expect(products[0].stockStatus).toContain("In stock");
    expect(products[0].source).toBe("heuristic");
  });

  it("does not misfire on an ordinary content page with a heading but no price anywhere", () => {
    const html = `<html><body><h1>About Our Company</h1><p>We were founded in 1990.</p></body></html>`;
    expect(detectProducts(html, extractStructuredData(html))).toEqual([]);
  });

  it("returns nothing for a page with no product markup at all", () => {
    const html = `<html><body><h1>About Us</h1><p>We are a company.</p></body></html>`;
    expect(detectProducts(html, extractStructuredData(html))).toEqual([]);
  });
});

describe("detectServices", () => {
  it("extracts a service from schema.org Service JSON-LD", () => {
    const html = `<script type="application/ld+json">
      { "@context": "https://schema.org", "@type": "Service", "name": "SEO Consulting", "description": "We improve your rankings.", "areaServed": ["USA", "Canada"] }
    </script>`;
    const services = detectServices(html, extractStructuredData(html));
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ name: "SEO Consulting", description: "We improve your rankings.", source: "structured_data" });
  });

  it("falls back to heuristic card pattern detection", () => {
    const html = `<section class="services">
      <h2>Our Services</h2>
      <div class="service-card"><h3>Web Design</h3><p>We build beautiful websites.</p></div>
      <div class="service-card"><h3>SEO</h3><p>We rank you higher.</p></div>
    </section>`;
    const services = detectServices(html, extractStructuredData(html));
    expect(services.map((s) => s.name)).toEqual(["Web Design", "SEO"]);
    expect(services[0].source).toBe("heuristic");
  });
});

describe("detectFaqs", () => {
  it("extracts FAQs from schema.org FAQPage JSON-LD", () => {
    const html = `<script type="application/ld+json">
      {
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [
          { "@type": "Question", "name": "What is your return policy?", "acceptedAnswer": { "@type": "Answer", "text": "30 days, no questions asked." } },
          { "@type": "Question", "name": "Do you ship internationally?", "acceptedAnswer": { "@type": "Answer", "text": "Yes, to most countries." } }
        ]
      }
    </script>`;
    const faqs = detectFaqs(html, extractStructuredData(html));
    expect(faqs).toHaveLength(2);
    expect(faqs[0]).toMatchObject({ question: "What is your return policy?", answer: "30 days, no questions asked.", source: "structured_data" });
  });

  it("falls back to <details>/<summary> accordion markup", () => {
    const html = `
      <details><summary>How long is shipping?</summary><p>3-5 business days.</p></details>
      <details><summary>Can I cancel my order?</summary><p>Yes, within 24 hours.</p></details>
    `;
    const faqs = detectFaqs(html, extractStructuredData(html));
    expect(faqs).toHaveLength(2);
    expect(faqs[0].question).toBe("How long is shipping?");
    expect(faqs[0].answer).toContain("3-5 business days");
    expect(faqs[0].source).toBe("heuristic");
  });

  it("falls back to question-like headings as a last resort", () => {
    const html = `<h3>Is this product waterproof?</h3><p>Yes, fully waterproof up to 10 meters.</p>`;
    const faqs = detectFaqs(html, extractStructuredData(html));
    expect(faqs).toHaveLength(1);
    expect(faqs[0].question).toBe("Is this product waterproof?");
  });
});
