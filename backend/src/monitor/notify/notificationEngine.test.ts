import { describe, it, expect } from "vitest";
import { determineChannels, deriveTrainingNotifications } from "./notificationEngine";
import type { NotificationSettingsInput, TrainingNotificationInput, HighlightInput } from "./notificationEngine";

function settings(overrides: Partial<NotificationSettingsInput> = {}): NotificationSettingsInput {
  return { emailEnabled: false, emailAddress: null, webhookEnabled: false, webhookUrl: null, enabledEmailTypes: [], enabledWebhookTypes: [], ...overrides };
}

describe("determineChannels", () => {
  it("always includes Dashboard and Log, even with no settings row", () => {
    expect(determineChannels("TRAINING_COMPLETED", null)).toEqual(["DASHBOARD", "LOG"]);
  });

  it("always includes Dashboard and Log with settings but nothing else enabled", () => {
    expect(determineChannels("TRAINING_COMPLETED", settings())).toEqual(["DASHBOARD", "LOG"]);
  });

  it("adds Email when enabled with an address and no type restriction", () => {
    expect(determineChannels("TRAINING_COMPLETED", settings({ emailEnabled: true, emailAddress: "admin@example.com" }))).toEqual(["DASHBOARD", "LOG", "EMAIL"]);
  });

  it("does not add Email when enabled but no address is configured", () => {
    expect(determineChannels("TRAINING_COMPLETED", settings({ emailEnabled: true, emailAddress: null }))).toEqual(["DASHBOARD", "LOG"]);
  });

  it("respects a type allow-list for Email", () => {
    const s = settings({ emailEnabled: true, emailAddress: "a@b.com", enabledEmailTypes: ["ERROR_OCCURRED"] });
    expect(determineChannels("ERROR_OCCURRED", s)).toContain("EMAIL");
    expect(determineChannels("TRAINING_COMPLETED", s)).not.toContain("EMAIL");
  });

  it("adds Webhook when enabled with a URL and no type restriction", () => {
    expect(determineChannels("NEW_PRODUCTS_FOUND", settings({ webhookEnabled: true, webhookUrl: "https://example.com/hook" }))).toEqual(["DASHBOARD", "LOG", "WEBHOOK"]);
  });

  it("respects a type allow-list for Webhook independently of Email's", () => {
    const s = settings({ webhookEnabled: true, webhookUrl: "https://example.com/hook", enabledWebhookTypes: ["JOB_FAILED"] });
    expect(determineChannels("JOB_FAILED", s)).toContain("WEBHOOK");
    expect(determineChannels("TRAINING_COMPLETED", s)).not.toContain("WEBHOOK");
  });

  it("can enable both Email and Webhook simultaneously with different type scopes", () => {
    const s = settings({ emailEnabled: true, emailAddress: "a@b.com", enabledEmailTypes: ["ERROR_OCCURRED"], webhookEnabled: true, webhookUrl: "https://example.com/hook", enabledWebhookTypes: [] });
    const channels = determineChannels("TRAINING_COMPLETED", s);
    expect(channels).toEqual(["DASHBOARD", "LOG", "WEBHOOK"]); // webhook allows all types, email is scoped to ERROR_OCCURRED only
  });
});

function report(overrides: Partial<TrainingNotificationInput> = {}): TrainingNotificationInput {
  return {
    pagesAdded: 0,
    pagesRemoved: 0,
    pagesUpdated: 0,
    entityChanges: [],
    metadataChanges: { technologyChanged: false, addedTechnologies: [], removedTechnologies: [] },
    ...overrides,
  };
}

const noHighlights: HighlightInput[] = [];

describe("deriveTrainingNotifications", () => {
  it("always emits TRAINING_COMPLETED, even with zero changes", () => {
    const events = deriveTrainingNotifications(report(), noHighlights);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "TRAINING_COMPLETED", severity: "SUCCESS" });
  });

  it("adds WEBSITE_UPDATED and KNOWLEDGE_UPDATED when pages changed", () => {
    const events = deriveTrainingNotifications(report({ pagesUpdated: 3 }), noHighlights);
    expect(events.map((e) => e.type)).toEqual(["TRAINING_COMPLETED", "WEBSITE_UPDATED", "KNOWLEDGE_UPDATED"]);
  });

  it("adds WEBSITE_UPDATED and KNOWLEDGE_UPDATED when only entities changed (no page churn)", () => {
    const events = deriveTrainingNotifications(report({ entityChanges: [{ category: "products", added: 1, removed: 0, updated: 0 }] }), noHighlights);
    expect(events.map((e) => e.type)).toContain("WEBSITE_UPDATED");
  });

  it("adds NEW_PRODUCTS_FOUND when products were added", () => {
    const events = deriveTrainingNotifications(report({ entityChanges: [{ category: "products", added: 2, removed: 0, updated: 0 }] }), noHighlights);
    expect(events.map((e) => e.type)).toContain("NEW_PRODUCTS_FOUND");
    expect(events.find((e) => e.type === "NEW_PRODUCTS_FOUND")?.title).toBe("2 new product(s) found");
  });

  it("adds NEW_SERVICES_FOUND when services were added", () => {
    const events = deriveTrainingNotifications(report({ entityChanges: [{ category: "services", added: 1, removed: 0, updated: 0 }] }), noHighlights);
    expect(events.map((e) => e.type)).toContain("NEW_SERVICES_FOUND");
  });

  it("does not add NEW_PRODUCTS_FOUND when products only changed (no additions)", () => {
    const events = deriveTrainingNotifications(report({ entityChanges: [{ category: "products", added: 0, removed: 0, updated: 4 }] }), noHighlights);
    expect(events.map((e) => e.type)).not.toContain("NEW_PRODUCTS_FOUND");
  });

  it("adds TECHNOLOGY_CHANGED with a WARNING severity when the tech stack changed", () => {
    const events = deriveTrainingNotifications(report({ metadataChanges: { technologyChanged: true, addedTechnologies: ["Next.js"], removedTechnologies: ["WordPress"] } }), noHighlights);
    const techEvent = events.find((e) => e.type === "TECHNOLOGY_CHANGED");
    expect(techEvent).toMatchObject({ severity: "WARNING", message: "Added: Next.js. Removed: WordPress." });
  });

  it("uses the highlight messages as the notification body when present", () => {
    const highlights: HighlightInput[] = [{ message: "2 new products found.", severity: "info" }];
    const events = deriveTrainingNotifications(report({ entityChanges: [{ category: "products", added: 2, removed: 0, updated: 0 }] }), highlights);
    expect(events[0].message).toBe("2 new products found.");
  });

  it("falls back to a default message when there are no highlights", () => {
    const events = deriveTrainingNotifications(report(), noHighlights);
    expect(events[0].message).toBe("Training completed with no notable changes.");
  });
});
