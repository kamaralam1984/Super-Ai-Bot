import type { SiteSignals, DetectionCandidate } from "../types";
import { CandidateBuilder, htmlAndScriptsHaystack } from "./signalUtils";

/** Analytics/tracking tag detection — every tool here loads a distinctive external script and/or leaves a distinctive inline call, so signals combine both. */
export function detectAnalytics(signals: SiteSignals): DetectionCandidate[] {
  const html = htmlAndScriptsHaystack(signals);
  const builder = new CandidateBuilder();

  if (/googletagmanager\.com\/gtag\/js|google-analytics\.com\/analytics\.js/i.test(html)) builder.add("Google Analytics", "Google Analytics script referenced", 0.9);
  if (/\bgtag\s*\(\s*['"]config['"]|\bga\s*\(\s*['"]create['"]/i.test(html)) builder.add("Google Analytics", "gtag('config',...)/ga('create',...) call found", 0.7);
  if (/\b(G|UA)-[A-Z0-9-]{6,}\b/.test(html)) builder.add("Google Analytics", "GA measurement/tracking ID pattern found", 0.5);

  if (/googletagmanager\.com\/gtm\.js/i.test(html)) builder.add("Google Tag Manager", "GTM container script referenced", 0.9);
  if (/\bGTM-[A-Z0-9]{4,}\b/.test(html)) builder.add("Google Tag Manager", "GTM-XXXXXXX container ID pattern found", 0.7);

  if (/connect\.facebook\.net\/[^"']*\/fbevents\.js/i.test(html)) builder.add("Meta Pixel", "Meta/Facebook Pixel script referenced", 0.9);
  if (/\bfbq\s*\(\s*['"]init['"]/i.test(html)) builder.add("Meta Pixel", "fbq('init',...) call found", 0.8);

  if (/static\.hotjar\.com/i.test(html)) builder.add("Hotjar", "Hotjar script referenced", 0.9);
  if (/\bhj\s*\(\s*['"]|_hjSettings/i.test(html)) builder.add("Hotjar", "hj(...) call or _hjSettings object found", 0.7);

  if (/\bclarity\.ms\b/i.test(html)) builder.add("Microsoft Clarity", "Microsoft Clarity script referenced", 0.9);

  if (/cdn\.mxpnl\.com/i.test(html)) builder.add("Mixpanel", "Mixpanel script referenced", 0.9);
  if (/mixpanel\.init\s*\(/i.test(html)) builder.add("Mixpanel", "mixpanel.init(...) call found", 0.8);

  if (/cdn\.amplitude\.com/i.test(html)) builder.add("Amplitude", "Amplitude script referenced", 0.9);
  if (/amplitude\.getInstance\s*\(/i.test(html)) builder.add("Amplitude", "amplitude.getInstance(...) call found", 0.8);

  if (/\bmatomo\.js\b|\bpiwik\.js\b/i.test(html)) builder.add("Matomo", "matomo.js/piwik.js script referenced", 0.9);
  if (/_paq\.push\s*\(/i.test(html)) builder.add("Matomo", "_paq.push(...) call found", 0.8);

  if (/snap\.licdn\.com\/li\.lms-analytics/i.test(html)) builder.add("LinkedIn Insight Tag", "LinkedIn Insight Tag script referenced", 0.9);
  if (/_linkedin_partner_id/i.test(html)) builder.add("LinkedIn Insight Tag", "_linkedin_partner_id variable found", 0.8);

  return builder.build();
}
