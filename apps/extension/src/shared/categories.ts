import {
  Bug,
  CircleSlash,
  Clapperboard,
  Clock,
  Dices,
  Download,
  Fingerprint,
  Flag,
  Gamepad2,
  Heart,
  Pill,
  Search,
  ShoppingCart,
  Shuffle,
  Swords,
  TriangleAlert,
  Users,
  VenetianMask,
  type LucideIcon,
} from "lucide-react";
import type { WebCategory } from "@eguard/schemas";

/** Every category a family can block, with the web dashboard's labels and order (~/eguard CATEGORY_META). */
export const CATEGORIES: { id: WebCategory; label: string; Icon: LucideIcon }[] = [
  { id: "ADULT", label: "Adult content", Icon: CircleSlash },
  { id: "GAMBLING", label: "Gambling", Icon: Dices },
  { id: "MALWARE", label: "Malware", Icon: Bug },
  { id: "PHISHING", label: "Phishing", Icon: VenetianMask },
  { id: "VIOLENCE", label: "Violence", Icon: Swords },
  { id: "DRUGS", label: "Drugs", Icon: Pill },
  { id: "WEAPONS", label: "Weapons", Icon: TriangleAlert },
  { id: "HATE", label: "Hate & extremism", Icon: Flag },
  { id: "DATING", label: "Dating", Icon: Heart },
  { id: "SOCIAL_MEDIA", label: "Social media", Icon: Users },
  { id: "GAMING", label: "Gaming", Icon: Gamepad2 },
  { id: "STREAMING", label: "Streaming", Icon: Clapperboard },
  { id: "SHOPPING", label: "Shopping", Icon: ShoppingCart },
  { id: "DOWNLOADS", label: "Downloads", Icon: Download },
  { id: "PROXY", label: "Proxies & translators", Icon: Shuffle },
];

const BY_ID = new Map<string, (typeof CATEGORIES)[number]>(CATEGORIES.map((c) => [c.id, c]));

/** Keys in the daily counts that aren't categories: the reason a page was blocked instead. */
const REASONS: Record<string, { label: string; Icon: LucideIcon }> = {
  BLOCKED_SITE: { label: "Blocked sites", Icon: CircleSlash },
  FOCUS_HOURS: { label: "Focus hours", Icon: Clock },
  UNKNOWN_SITE: { label: "Not on the allowed list", Icon: Fingerprint },
  SAFE_SEARCH: { label: "Searches outside SafeSearch", Icon: Search },
};

/** Label and icon for a category or a block reason ("GAMING", "FOCUS_HOURS"). */
export function categoryVisual(key: string): { label: string; Icon: LucideIcon } {
  return BY_ID.get(key) ?? REASONS[key] ?? { label: "Other", Icon: CircleSlash };
}
