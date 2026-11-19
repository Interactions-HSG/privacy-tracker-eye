// Miner shirts — which tracker organisation a miner works for.
// -----------------------------------------------------------------------------
// A shirt is the organisation's colours plus its initial on a chest badge. As
// with the eye skins, no logotype is drawn: at this size a colour and a letter
// identify the company, and the miner stays a character rather than an advert.
// Organisations without an entry get a colour derived from their name, so every
// tracker on a page still fields a recognisably different worker.

export interface Shirt {
  /** Shirt colour. */
  body: string;
  /** Optional brand-colour bands across the hem. */
  stripes?: readonly string[];
  /** Chest badge background … */
  badge: string;
  /** … and the colour of the letter on it. */
  ink: string;
  letter: string;
}

type ShirtSpec = Omit<Shirt, "letter"> & { letter?: string };

const WHITE = "#ffffff";

/** Keyed by the organisation names used in src/data/trackers.ts. */
const SHIRTS: Record<string, ShirtSpec> = {
  Google: { body: "#4285F4", stripes: ["#4285F4", "#EA4335", "#FBBC05", "#34A853"], badge: WHITE, ink: "#4285F4" },
  Amazon: { body: "#232F3E", stripes: ["#FF9900"], badge: "#FF9900", ink: "#232F3E", letter: "a" },
  Meta: { body: "#0866FF", badge: WHITE, ink: "#0866FF" },
  Microsoft: { body: "#5E5E5E", stripes: ["#F25022", "#7FBA00", "#00A4EF", "#FFB900"], badge: WHITE, ink: "#5E5E5E" },
  X: { body: "#111111", badge: WHITE, ink: "#111111" },
  TikTok: { body: "#111111", stripes: ["#25F4EE", "#FE2C55"], badge: WHITE, ink: "#111111" },
  Adobe: { body: "#FA0F00", badge: WHITE, ink: "#FA0F00" },
  Oracle: { body: "#C74634", badge: WHITE, ink: "#C74634" },
  Yandex: { body: "#FC3F1D", badge: WHITE, ink: "#FC3F1D" },
  Yahoo: { body: "#6001D2", badge: WHITE, ink: "#6001D2" },
  Pinterest: { body: "#E60023", badge: WHITE, ink: "#E60023" },
  Reddit: { body: "#FF4500", badge: WHITE, ink: "#FF4500" },
  Snap: { body: "#FFFC00", badge: "#111111", ink: "#FFFC00" },
  VK: { body: "#0077FF", badge: WHITE, ink: "#0077FF" },
  Criteo: { body: "#FE5000", badge: WHITE, ink: "#FE5000" },
  Taboola: { body: "#0056D6", badge: WHITE, ink: "#0056D6" },
  Outbrain: { body: "#EE6513", badge: WHITE, ink: "#EE6513" },
  Hotjar: { body: "#FF3C00", badge: WHITE, ink: "#FF3C00" },
  Cloudflare: { body: "#F38020", badge: WHITE, ink: "#F38020" },
  Stripe: { body: "#635BFF", badge: WHITE, ink: "#635BFF" },
  Zendesk: { body: "#03363D", badge: WHITE, ink: "#03363D" },
  Intercom: { body: "#286EFA", badge: WHITE, ink: "#286EFA" },
  Quantcast: { body: "#1B1B1B", badge: WHITE, ink: "#1B1B1B" },
  Comscore: { body: "#F26522", badge: WHITE, ink: "#F26522" },
};

/** A miner nobody has claimed (no tracker identified on the page). */
const ANONYMOUS: Shirt = { body: "#6b7385", badge: WHITE, ink: "#6b7385", letter: "?" };

/** Stable hue from a name, so an unlisted organisation always gets the same shirt. */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function shirtFor(organization: string | null): Shirt {
  if (!organization) return ANONYMOUS;
  const letter = organization.trim().charAt(0).toUpperCase() || "?";
  const spec = SHIRTS[organization];
  if (spec) return { ...spec, letter: spec.letter ?? letter };
  const body = `hsl(${hueOf(organization)}, 58%, 42%)`;
  return { body, badge: WHITE, ink: body, letter };
}
