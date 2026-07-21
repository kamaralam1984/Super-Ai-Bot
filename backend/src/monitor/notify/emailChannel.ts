// Email notification delivery via SMTP (nodemailer). SMTP server
// credentials live in server-wide `.env` (`SMTP_*`), not per-installation
// DB rows — a self-hosted single-tenant install has exactly one outbound
// mail relay, the same reasoning `NotificationSettings`'s schema doc
// comment gives for keeping `emailAddress`/`webhookUrl` (not secrets) in
// the database while credentials stay in the environment.

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Returns `null` when `SMTP_HOST` isn't set — email notifications are opt-in infrastructure, not a hard requirement, so a self-hosted install with no mail relay configured simply never gets an EMAIL channel offered (see monitorOrchestrator.service.ts). */
export function loadEmailConfigFromEnv(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  if (!env.SMTP_HOST) return null;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM || env.SMTP_USER || "no-reply@localhost",
  };
}

let cachedTransporter: Transporter | null = null;
let cachedConfigKey: string | null = null;

function getTransporter(config: EmailConfig): Transporter {
  const key = JSON.stringify(config);
  if (!cachedTransporter || cachedConfigKey !== key) {
    cachedTransporter = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.user ? { user: config.user, pass: config.pass } : undefined });
    cachedConfigKey = key;
  }
  return cachedTransporter;
}

/** Test-only hook — forces a fresh transporter on the next call, since tests swap SMTP config/mocks between cases. */
export function resetEmailTransporterCache(): void {
  cachedTransporter = null;
  cachedConfigKey = null;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  errorMessage?: string;
}

/** `transporter` is injectable for testing (e.g. nodemailer's own `streamTransport`, which validates a real message without any network call) — defaults to the cached SMTP transporter built from `config`. */
export async function sendNotificationEmail(config: EmailConfig, params: SendEmailParams, transporter: Transporter = getTransporter(config)): Promise<SendEmailResult> {
  try {
    await transporter.sendMail({ from: config.from, to: params.to, subject: params.subject, text: params.text });
    return { ok: true };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
