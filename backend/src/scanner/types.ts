import type { TechStackSignals } from "./discovery/techStack";
import type { LinkCategory } from "./discovery/linkClassifier";

export interface ClassifiedLink {
  url: string;
  category: LinkCategory;
}

export interface DiscoveryResult {
  baseUrl: string;
  robotsTxtFound: boolean;
  robotsTxtContent: string | null;
  sitemapUrls: string[];
  rssFeedUrls: string[];
  homepageLinks: ClassifiedLink[];
  seedUrls: string[];
  techStack: TechStackSignals;
  warnings: string[];
}
