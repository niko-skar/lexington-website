import type { Image } from "sanity";

export type UnitStatus = "available" | "reserved" | "sold";

export type BedroomType = "One Bedroom" | "Two Bedroom" | "3BR Duplex Penthouse";

export interface Unit {
  _id: string;
  unitNumber: string;
  floor: number;
  bedroomType: BedroomType;
  areaSqm: number;
  priceUSD: number;
  status: UnitStatus;
  notes?: string;
}

export type GalleryCategory =
  | "exterior"
  | "interior"
  | "amenity"
  | "floorplan"
  | "family";

export interface GalleryImage {
  _id: string;
  image: Image;
  alt: string;
  category: GalleryCategory;
  order: number;
}

export type AmenityCategory = "rooftop" | "signature" | "building feature";

export interface Amenity {
  _id: string;
  name: string;
  category: AmenityCategory;
  order: number;
}

export interface FamilyMember {
  _id: string;
  name: string;
  years: string;
  bio: string;
  order: number;
}

export interface SelfFinanceRow {
  milestone: string;
  timeframe: string;
  option1: string;
  option2?: string;
}

export interface UpfrontDiscountTier {
  upfrontPayment: string;
  discount: string;
}

export interface MortgageRow {
  milestone: string;
  timeframe: string;
  option1: string;
}

export interface FinancingPlan {
  _id: string;
  selfFinanceRows: SelfFinanceRow[];
  upfrontDiscountTiers: UpfrontDiscountTier[];
  mortgageRows: MortgageRow[];
  buyToRent: {
    oneBedroomRange: string;
    twoBedroomRange: string;
    projectedYieldPct: number;
  };
}

export interface PageIntroContent {
  eyebrow: string;
  title: string;
  lede?: string;
}

export interface SiteSettings {
  _id: string;
  contactPhone: string;
  contactEmail: string;
  notificationEmail: string;
  officeAddress: string;
  disclaimer: string;
  heroEyebrow: string;
  heroTitle: string;
  heroLede: string;
  residencesIntro: PageIntroContent;
  amenitiesIntro: PageIntroContent;
  galleryIntro: PageIntroContent;
  investIntro: PageIntroContent;
  aboutIntro: PageIntroContent;
  contactIntro: PageIntroContent;
}
