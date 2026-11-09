import type { PostStatus } from "./posts/status";

export interface Post {
  id: string;
  title: string;
  content: string;
  hashtags: string[];
  link_url: string | null;
  image_path: string | null;
  image_asset_id: string | null;
  product_id: string | null;
  post_type: string | null;
  image_suggestion: string | null;
  rationale: string | null;
  quality: QualityAssessment | null;
  variants: PostVariant[];
  verification_notes: string[];
  scheduled_at: string | null;
  status: PostStatus;
  approved_at: string | null;
  approved_by: string | null;
  approved_content_hash: string | null;
  published_at: string | null;
  facebook_post_id: string | null;
  facebook_post_url: string | null;
  publish_error: string | null;
  generated_by: "ai" | "owner";
  ai_model: string | null;
  generation_batch_id: string | null;
  contest_id?: string | null;
  contest_role?: "kunngjoring" | "paminnelse" | "vinner" | null;
  created_at: string;
  updated_at: string;
}

export interface PostVariant {
  title: string;
  content: string;
}

export interface QualityAssessment {
  relevance: number;
  language: number;
  originality: number;
  product_accuracy: number;
  marketing_value: number;
  visual_quality: number;
  notes: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  product_url: string | null;
  source: "manual" | "import";
  external_id: string | null;
  active: boolean;
  needs_verification: boolean;
  verification_note: string | null;
  last_synced_at: string | null;
  source_image_urls: string[];
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  storage_path: string;
  image_type: "product_photo" | "detail" | "lifestyle" | "cutout";
  is_primary: boolean;
  alt_text: string | null;
  source_url: string | null;
  created_at: string;
}

export interface MediaAsset {
  id: string;
  storage_path: string;
  kind: "upload" | "ai_generated" | "composite" | "text_graphic";
  is_ai_generated: boolean;
  contains_real_product_photo: boolean;
  prompt: string | null;
  provider: string | null;
  width: number | null;
  height: number | null;
  format: "square" | "portrait" | "landscape" | "original" | null;
  product_id: string | null;
  source_asset_id: string | null;
  source_product_image_id: string | null;
  in_library: boolean;
  description: string | null;
  tags: string[];
  category: string | null;
  people_visible: boolean | null;
  analysis_status: "none" | "pending" | "done" | "failed";
  analysis_error: string | null;
  analyzed_at: string | null;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
}

export interface WeeklyPlanItem {
  day: number; // 1 = mandag
  theme: string;
}

export interface SeasonalCampaign {
  key: string;
  name: string;
  enabled: boolean;
  note?: string;
}

export interface BusinessSettings {
  id: number;
  business_name: string;
  website: string;
  language: string;
  brand_voice: string;
  posting_frequency: number;
  preferred_days: number[];
  preferred_times: string[];
  timezone: string;
  default_hashtags: string[];
  prioritized_product_ids: string[];
  weekly_plan: WeeklyPlanItem[];
  seasonal_campaigns: SeasonalCampaign[];
  ai_model: string;
  image_provider: "openai" | "none";
  test_mode: boolean;
  /** Finnes etter migrasjon 6 */
  utm_enabled?: boolean;
  utm_source?: string;
  utm_medium?: string;
  updated_at: string;
}

export interface FacebookStatus {
  page_id: string;
  page_name: string;
  connection_status: "connected" | "expired" | "revoked" | "error" | "disconnected";
  token_expires_at: string | null;
  granted_scopes: string[];
  connected_at: string;
  last_checked_at: string | null;
  last_error: string | null;
}
