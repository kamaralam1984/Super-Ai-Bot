import { describe, it, expect } from "vitest";
import { parsePageContent } from "./htmlParser";

describe("parsePageContent", () => {
  it("extracts title, meta description, and canonical URL", () => {
    const html = `<html><head>
      <title>Acme — Home</title>
      <meta name="description" content="Acme makes widgets.">
      <link rel="canonical" href="https://acme.com/">
    </head><body></body></html>`;
    const result = parsePageContent(html);
    expect(result.title).toBe("Acme — Home");
    expect(result.metaDescription).toBe("Acme makes widgets.");
    expect(result.canonicalUrl).toBe("https://acme.com/");
  });

  it("extracts headings by level", () => {
    const html = `<body><h1>Main</h1><h2>Sub A</h2><h2>Sub B</h2><h3>Detail</h3></body>`;
    const result = parsePageContent(html);
    expect(result.headings.h1).toEqual(["Main"]);
    expect(result.headings.h2).toEqual(["Sub A", "Sub B"]);
    expect(result.headings.h3).toEqual(["Detail"]);
  });

  it("preserves row structure in tables (regression: cheerio .map().get() double-flatten)", () => {
    const html = `<table>
      <thead><tr><th>Name</th><th>Price</th></tr></thead>
      <tbody>
        <tr><td>Widget</td><td>$10</td></tr>
        <tr><td>Gadget</td><td>$20</td></tr>
      </tbody>
    </table>`;
    const result = parsePageContent(html);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].headers).toEqual(["Name", "Price"]);
    expect(result.tables[0].rows).toEqual([
      ["Widget", "$10"],
      ["Gadget", "$20"],
    ]);
  });

  it("extracts list items without flattening across separate lists", () => {
    const html = `<ul><li>Apple</li><li>Banana</li></ul><ol><li>Step 1</li><li>Step 2</li></ol>`;
    const result = parsePageContent(html);
    expect(result.lists).toHaveLength(2);
    expect(result.lists[0]).toEqual({ ordered: false, items: ["Apple", "Banana"] });
    expect(result.lists[1]).toEqual({ ordered: true, items: ["Step 1", "Step 2"] });
  });

  it("excludes nav/footer lists from the generic lists extraction", () => {
    const html = `<nav><ul><li>Home</li><li>About</li></ul></nav><ul><li>Real content item</li></ul>`;
    const result = parsePageContent(html);
    expect(result.lists).toHaveLength(1);
    expect(result.lists[0].items).toEqual(["Real content item"]);
  });

  it("detects CTA buttons by common action phrases", () => {
    const html = `<a href="/cart" class="btn">Add to Cart</a><a href="/about">About Us</a><button>Sign Up</button>`;
    const result = parsePageContent(html);
    expect(result.ctaButtons).toContain("Add to Cart");
    expect(result.ctaButtons).toContain("Sign Up");
    expect(result.ctaButtons).not.toContain("About Us");
  });

  it("extracts images with alt text and figure captions", () => {
    const html = `<img src="/logo.png" alt="Acme logo"><figure><img src="/product.jpg" alt="Widget"><figcaption>Our best widget</figcaption></figure>`;
    const result = parsePageContent(html);
    expect(result.images).toEqual([
      { src: "/logo.png", alt: "Acme logo", caption: null },
      { src: "/product.jpg", alt: "Widget", caption: "Our best widget" },
    ]);
  });

  it("classifies embedded YouTube videos", () => {
    const html = `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>`;
    const result = parsePageContent(html);
    expect(result.videos).toEqual([{ src: "https://www.youtube.com/embed/dQw4w9WgXcQ", type: "youtube" }]);
  });

  it("extracts form fields", () => {
    const html = `<form action="/subscribe" method="post"><input name="email" type="email"><input name="name" type="text"><button type="submit">Go</button></form>`;
    const result = parsePageContent(html);
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0].action).toBe("/subscribe");
    expect(result.forms[0].method).toBe("POST");
    expect(result.forms[0].fields).toEqual(expect.arrayContaining([{ name: "email", type: "email" }, { name: "name", type: "text" }]));
  });

  it("extracts contact info from tel:/mailto: links and text", () => {
    const html = `<body>
      <a href="tel:+1-555-123-4567">Call us</a>
      <a href="mailto:hello@acme.com">Email</a>
      <a href="https://wa.me/15551234567">WhatsApp</a>
      <a href="https://www.google.com/maps/place/Acme+HQ">Find us</a>
      <a href="https://facebook.com/acmehq">Facebook</a>
    </body>`;
    const result = parsePageContent(html);
    expect(result.contactInfo.phones).toContain("+1-555-123-4567");
    expect(result.contactInfo.emails).toContain("hello@acme.com");
    expect(result.contactInfo.whatsappLinks).toContain("https://wa.me/15551234567");
    expect(result.contactInfo.mapsLinks[0]).toContain("google.com/maps");
    expect(result.contactInfo.socialLinks).toEqual([{ platform: "Facebook", url: "https://facebook.com/acmehq" }]);
  });

  it("extracts LocalBusiness JSON-LD address and hours", () => {
    const html = `<script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": "Acme HQ",
        "telephone": "+1-555-000-1111",
        "address": { "@type": "PostalAddress", "streetAddress": "1 Acme Way", "addressLocality": "Springfield", "postalCode": "12345" },
        "openingHoursSpecification": { "dayOfWeek": ["Monday", "Tuesday"], "opens": "09:00", "closes": "17:00" }
      }
    </script>`;
    const result = parsePageContent(html);
    expect(result.contactInfo.phones).toContain("+1-555-000-1111");
    expect(result.contactInfo.addresses[0]).toContain("1 Acme Way");
    expect(result.contactInfo.businessHours[0]).toContain("09:00-17:00");
    expect(result.structuredData.jsonLd).toHaveLength(1);
  });

  it("strips scripts, styles, and hidden elements from extracted text", () => {
    const html = `<body><p>Visible</p><p style="display:none">Hidden</p><script>var x = "Should not appear as a paragraph";</script></body>`;
    const result = parsePageContent(html);
    expect(result.paragraphs).toEqual(["Visible"]);
  });
});
