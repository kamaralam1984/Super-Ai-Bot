import { describe, it, expect, vi } from "vitest";
import nodemailer from "nodemailer";
import { loadEmailConfigFromEnv, sendNotificationEmail } from "./emailChannel";
import type { EmailConfig } from "./emailChannel";

describe("loadEmailConfigFromEnv", () => {
  it("returns null when SMTP_HOST is not set", () => {
    expect(loadEmailConfigFromEnv({})).toBeNull();
  });

  it("parses a full config from env vars", () => {
    const config = loadEmailConfigFromEnv({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USER: "user", SMTP_PASS: "pass", SMTP_FROM: "notify@example.com" });
    expect(config).toEqual({ host: "smtp.example.com", port: 465, secure: true, user: "user", pass: "pass", from: "notify@example.com" });
  });

  it("defaults port to 587 and secure to false when unset", () => {
    const config = loadEmailConfigFromEnv({ SMTP_HOST: "smtp.example.com" });
    expect(config?.port).toBe(587);
    expect(config?.secure).toBe(false);
  });

  it("falls back to SMTP_USER, then a placeholder, for the from address", () => {
    expect(loadEmailConfigFromEnv({ SMTP_HOST: "h", SMTP_USER: "user@example.com" })?.from).toBe("user@example.com");
    expect(loadEmailConfigFromEnv({ SMTP_HOST: "h" })?.from).toBe("no-reply@localhost");
  });
});

const config: EmailConfig = { host: "smtp.example.com", port: 587, secure: false, from: "notify@example.com" };

describe("sendNotificationEmail", () => {
  it("sends a real, well-formed message through nodemailer's streamTransport (no network call)", async () => {
    // streamTransport validates and serializes a genuine RFC 5322 message
    // without touching the network — real integration coverage for
    // message construction, not a mock of nodemailer's internals.
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const sendMailSpy = vi.spyOn(transporter, "sendMail");

    const result = await sendNotificationEmail(config, { to: "admin@example.com", subject: "Training completed", text: "Your knowledge base was updated." }, transporter);

    expect(result.ok).toBe(true);
    expect(sendMailSpy).toHaveBeenCalledWith({ from: "notify@example.com", to: "admin@example.com", subject: "Training completed", text: "Your knowledge base was updated." });
  });

  it("returns ok:false with the error message when the transporter throws", async () => {
    const failingTransporter = { sendMail: vi.fn().mockRejectedValue(new Error("connection refused")) } as unknown as Parameters<typeof sendNotificationEmail>[2];
    const result = await sendNotificationEmail(config, { to: "admin@example.com", subject: "x", text: "y" }, failingTransporter);
    expect(result).toEqual({ ok: false, errorMessage: "connection refused" });
  });
});
