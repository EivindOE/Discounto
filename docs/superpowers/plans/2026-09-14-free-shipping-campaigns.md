# Fri frakt i kampanjer – implementasjonsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En kampanje kan gi rabatt, fri frakt eller begge, og storefront viser «Fri frakt»-badge etter butikkens valg.

**Architecture:** Dagens Shopify basic-rabatt beholdes for prisdelen. En ny JavaScript Discount Function (`discounto-free-shipping`) gir 100 % fraktrabatt når kurven har et kampanjeprodukt, og opprettes som en egen automatisk app-rabatt per kampanje. En felles synk-modul oppretter/oppdaterer/sletter begge rabattene og rydder opp ved feil. Storefront-scriptet får offer-type og badge-oppsett via app-proxyen.

**Tech Stack:** Remix + Polaris, Prisma (PostgreSQL), Shopify Admin GraphQL 2026-07, Shopify Functions (JavaScript), theme app extension (Liquid + vanilla JS), vitest 3.

**Spec:** `docs/superpowers/specs/2026-09-14-free-shipping-campaigns-design.md`

## Global Constraints

- Admin API-versjon: `ApiVersion.July26` (2026-07). Function `api_version = "2026-07"`.
- Function handle: `discounto-free-shipping`. Metafelt: namespace `$app`, key `function-configuration`, type `json`.
- Offer-verdier: `DISCOUNT`, `FREE_SHIPPING`, `DISCOUNT_AND_FREE_SHIPPING`. Badge-oppsett: `SEPARATE`, `COMBINED`, `DISCOUNT_ONLY`.
- Standard fraktbadge-tekst: `Free shipping`. Standard posisjon for fraktbadge: `bottom-right`.
- All admin-UI-tekst er på engelsk, som resten av appen.
- Eksisterende kampanjer (`DISCOUNT`) skal oppføre seg nøyaktig som før, inkludert `combinesWith.shippingDiscounts: false`.
- Scopes endres ikke (`write_discounts` finnes).
- Ingen minstebeløp, destinasjonsbegrensning eller rabattkoder.
- Verifisering etter hver task: `npx tsc --noEmit`, `npm run lint`, `npm test` (fra Task 1).

## Filstruktur

| Fil | Ansvar |
|---|---|
| `vitest.config.ts` (ny) | Testoppsett for appen, uavhengig av Remix sin `vite.config.ts` |
| `app/lib/campaign-offer.ts` (ny) | Rene typer/hjelpere for offer, badge-oppsett, Function-konfigurasjon og visningsetikett (brukes både server og klient) |
| `app/lib/campaigns.server.ts` | + `parseCampaignOfferFields` (skjemavalidering for offer-feltene) |
| `app/models/shopify-discounts.server.ts` | + app-rabatt create/update for frakt, `combinesWithShippingDiscounts` på basic-rabatt |
| `app/models/campaign-discount-sync.server.ts` (ny) | Orkestrerer begge Shopify-rabattene per kampanje, rollback, `CampaignSyncError` |
| `prisma/schema.prisma` + ny migrering | Nye enums og felt |
| `app/models/discount.server.ts` | Lagrer nye felt og begge Shopify-ID-er |
| `app/routes/app.discounts.new.tsx`, `app.discounts.$campaignId.tsx`, `app.discounts._index.tsx`, `app._index.tsx` | Bruker validering + synk-modul, viser offer-etikett |
| `app/components/CampaignEditor.tsx` | Offer-, fraktbadge- og badge-display-felt |
| `extensions/discounto-free-shipping/` (ny) | Shopify Function for fri frakt |
| `shopify.app.toml` | Metafelt-definisjon for Function-konfigurasjonen |
| `app/routes/proxy.better-discounts.campaigns.tsx` | Sender offer-felt til storefront |
| `extensions/better-discounts-theme/**` | Ny posisjonsinnstilling, badge-logikk på kort og produktside, CSS for stablede badges |

Rekkefølge: Task 1–3 er rene moduler med tester og kan ikke brekke eksisterende kode. Task 4 kobler dem inn i database og ruter. Task 5 (editor), Task 6 (Function) og Task 7 (storefront) bygger på Task 4. Task 8 er ende-til-ende-test i dev-butikk.

---

### Task 1: Testoppsett og offer-hjelpere

**Files:**
- Modify: `package.json` (script `test`, devDependency `vitest`)
- Create: `vitest.config.ts`
- Create: `app/lib/campaign-offer.ts`
- Create: `app/lib/campaign-offer.test.ts`
- Modify: `app/lib/campaigns.server.ts` (legg til `parseCampaignOfferFields` nederst)
- Create: `app/lib/campaigns.server.test.ts`

**Interfaces:**
- Consumes: `normalizeDiscountKind` (finnes i `app/lib/campaigns.server.ts`), `DiscountKind` fra `@prisma/client`.
- Produces:
  - `CampaignOfferType = "DISCOUNT" | "FREE_SHIPPING" | "DISCOUNT_AND_FREE_SHIPPING"`
  - `CampaignBadgeLayoutType = "SEPARATE" | "COMBINED" | "DISCOUNT_ONLY"`
  - `DEFAULT_FREE_SHIPPING_BADGE_TEXT = "Free shipping"`
  - `normalizeOfferType(value: unknown): CampaignOfferType`
  - `normalizeBadgeLayout(value: unknown): CampaignBadgeLayoutType`
  - `offerIncludesDiscount(offerType): boolean`, `offerIncludesFreeShipping(offerType): boolean`
  - `ShippingFunctionConfiguration = { productIds: string[]; collectionIds: string[] }`
  - `buildShippingFunctionConfiguration({ selectedProducts: Array<{ productGid: string }>, selectedCollections: Array<{ collectionGid: string }> }): ShippingFunctionConfiguration`
  - `formatCampaignOfferLabel({ offerType, discountKind, discountValue, currencyCode }): string`
  - `CampaignOfferFields = { offerType; discountKind: DiscountKind | null; discountValue: number | null; freeShippingBadgeText: string | null; badgeLayout }`
  - `parseCampaignOfferFields(formData: FormData): { ok: true; fields: CampaignOfferFields } | { ok: false; error: string }`

- [ ] **Step 1: Installer vitest og legg til test-script**

Run: `npm install --save-dev vitest@3.2.7`

Legg til i `"scripts"` i `package.json` (etter `"lint"`):

```json
    "test": "vitest run",
```

- [ ] **Step 2: Lag `vitest.config.ts`**

Remix-pluginen i `vite.config.ts` skal ikke lastes i tester, så appen får egen config:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Skriv feilende tester for offer-hjelperne**

`app/lib/campaign-offer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildShippingFunctionConfiguration,
  formatCampaignOfferLabel,
  normalizeBadgeLayout,
  normalizeOfferType,
  offerIncludesDiscount,
  offerIncludesFreeShipping,
} from "./campaign-offer";

describe("normalizeOfferType", () => {
  it("keeps known offer types", () => {
    expect(normalizeOfferType("FREE_SHIPPING")).toBe("FREE_SHIPPING");
    expect(normalizeOfferType("DISCOUNT_AND_FREE_SHIPPING")).toBe("DISCOUNT_AND_FREE_SHIPPING");
  });

  it("falls back to DISCOUNT for unknown or missing values", () => {
    expect(normalizeOfferType("nope")).toBe("DISCOUNT");
    expect(normalizeOfferType(null)).toBe("DISCOUNT");
  });
});

describe("normalizeBadgeLayout", () => {
  it("keeps known layouts and falls back to SEPARATE", () => {
    expect(normalizeBadgeLayout("COMBINED")).toBe("COMBINED");
    expect(normalizeBadgeLayout(undefined)).toBe("SEPARATE");
  });
});

describe("offer parts", () => {
  it("reports which parts each offer includes", () => {
    expect(offerIncludesDiscount("DISCOUNT")).toBe(true);
    expect(offerIncludesFreeShipping("DISCOUNT")).toBe(false);
    expect(offerIncludesDiscount("FREE_SHIPPING")).toBe(false);
    expect(offerIncludesFreeShipping("FREE_SHIPPING")).toBe(true);
    expect(offerIncludesDiscount("DISCOUNT_AND_FREE_SHIPPING")).toBe(true);
    expect(offerIncludesFreeShipping("DISCOUNT_AND_FREE_SHIPPING")).toBe(true);
  });
});

describe("buildShippingFunctionConfiguration", () => {
  it("collects unique product and collection ids", () => {
    expect(
      buildShippingFunctionConfiguration({
        selectedProducts: [
          { productGid: "gid://shopify/Product/1" },
          { productGid: "gid://shopify/Product/1" },
        ],
        selectedCollections: [{ collectionGid: "gid://shopify/Collection/9" }],
      }),
    ).toEqual({
      productIds: ["gid://shopify/Product/1"],
      collectionIds: ["gid://shopify/Collection/9"],
    });
  });
});

describe("formatCampaignOfferLabel", () => {
  it("formats every offer type", () => {
    const base = { discountKind: "PERCENTAGE" as const, discountValue: 10, currencyCode: "NOK" };
    expect(formatCampaignOfferLabel({ ...base, offerType: "DISCOUNT" })).toBe("10%");
    expect(
      formatCampaignOfferLabel({ ...base, discountKind: "FIXED_AMOUNT", offerType: "DISCOUNT" }),
    ).toBe("10 NOK");
    expect(
      formatCampaignOfferLabel({
        offerType: "FREE_SHIPPING",
        discountKind: null,
        discountValue: null,
        currencyCode: "NOK",
      }),
    ).toBe("Free shipping");
    expect(formatCampaignOfferLabel({ ...base, offerType: "DISCOUNT_AND_FREE_SHIPPING" })).toBe(
      "10% + free shipping",
    );
  });
});
```

- [ ] **Step 4: Kjør testene og se at de feiler**

Run: `npm test`
Expected: FAIL – `Failed to resolve import "./campaign-offer"`.

- [ ] **Step 5: Implementer `app/lib/campaign-offer.ts`**

```ts
export const CAMPAIGN_OFFER_TYPES = [
  "DISCOUNT",
  "FREE_SHIPPING",
  "DISCOUNT_AND_FREE_SHIPPING",
] as const;
export type CampaignOfferType = (typeof CAMPAIGN_OFFER_TYPES)[number];

export const CAMPAIGN_BADGE_LAYOUTS = ["SEPARATE", "COMBINED", "DISCOUNT_ONLY"] as const;
export type CampaignBadgeLayoutType = (typeof CAMPAIGN_BADGE_LAYOUTS)[number];

export const DEFAULT_FREE_SHIPPING_BADGE_TEXT = "Free shipping";

export type ShippingFunctionConfiguration = {
  productIds: string[];
  collectionIds: string[];
};

export function normalizeOfferType(value: unknown): CampaignOfferType {
  const text = String(value ?? "");
  return (CAMPAIGN_OFFER_TYPES as readonly string[]).includes(text)
    ? (text as CampaignOfferType)
    : "DISCOUNT";
}

export function normalizeBadgeLayout(value: unknown): CampaignBadgeLayoutType {
  const text = String(value ?? "");
  return (CAMPAIGN_BADGE_LAYOUTS as readonly string[]).includes(text)
    ? (text as CampaignBadgeLayoutType)
    : "SEPARATE";
}

export function offerIncludesDiscount(offerType: CampaignOfferType) {
  return offerType !== "FREE_SHIPPING";
}

export function offerIncludesFreeShipping(offerType: CampaignOfferType) {
  return offerType !== "DISCOUNT";
}

export function buildShippingFunctionConfiguration({
  selectedProducts,
  selectedCollections,
}: {
  selectedProducts: Array<{ productGid: string }>;
  selectedCollections: Array<{ collectionGid: string }>;
}): ShippingFunctionConfiguration {
  return {
    productIds: [...new Set(selectedProducts.map((product) => product.productGid))],
    collectionIds: [
      ...new Set(selectedCollections.map((collection) => collection.collectionGid)),
    ],
  };
}

export function formatCampaignOfferLabel({
  offerType,
  discountKind,
  discountValue,
  currencyCode,
}: {
  offerType: CampaignOfferType;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | null;
  discountValue: number | null;
  currencyCode: string;
}) {
  if (offerType === "FREE_SHIPPING") {
    return "Free shipping";
  }

  const discountLabel =
    discountValue == null
      ? ""
      : discountKind === "FIXED_AMOUNT"
        ? `${discountValue} ${currencyCode}`
        : `${discountValue}%`;

  return offerType === "DISCOUNT_AND_FREE_SHIPPING"
    ? `${discountLabel} + free shipping`
    : discountLabel;
}
```

- [ ] **Step 6: Kjør testene og se at de passerer**

Run: `npm test`
Expected: PASS (5 tester i `campaign-offer.test.ts`).

- [ ] **Step 7: Skriv feilende tester for `parseCampaignOfferFields`**

`app/lib/campaigns.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCampaignOfferFields } from "./campaigns.server";

function form(values: Record<string, string>) {
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

describe("parseCampaignOfferFields", () => {
  it("parses a discount-only campaign like before", () => {
    expect(
      parseCampaignOfferFields(
        form({ discountKind: "FIXED_AMOUNT", discountValue: "50", freeShippingBadgeText: "Fri frakt" }),
      ),
    ).toEqual({
      ok: true,
      fields: {
        offerType: "DISCOUNT",
        discountKind: "FIXED_AMOUNT",
        discountValue: 50,
        freeShippingBadgeText: null,
        badgeLayout: "SEPARATE",
      },
    });
  });

  it("rejects a missing discount value when the offer includes a discount", () => {
    expect(
      parseCampaignOfferFields(form({ offerType: "DISCOUNT_AND_FREE_SHIPPING", discountValue: "0" })),
    ).toEqual({ ok: false, error: "Enter a discount value greater than 0." });
  });

  it("stores no discount for a free-shipping-only campaign", () => {
    expect(
      parseCampaignOfferFields(
        form({ offerType: "FREE_SHIPPING", discountValue: "", freeShippingBadgeText: "  Fri frakt " }),
      ),
    ).toEqual({
      ok: true,
      fields: {
        offerType: "FREE_SHIPPING",
        discountKind: null,
        discountValue: null,
        freeShippingBadgeText: "Fri frakt",
        badgeLayout: "SEPARATE",
      },
    });
  });

  it("keeps the badge layout for a combined offer", () => {
    const result = parseCampaignOfferFields(
      form({
        offerType: "DISCOUNT_AND_FREE_SHIPPING",
        discountKind: "PERCENTAGE",
        discountValue: "10",
        freeShippingBadgeText: "",
        badgeLayout: "COMBINED",
      }),
    );

    expect(result).toEqual({
      ok: true,
      fields: {
        offerType: "DISCOUNT_AND_FREE_SHIPPING",
        discountKind: "PERCENTAGE",
        discountValue: 10,
        freeShippingBadgeText: null,
        badgeLayout: "COMBINED",
      },
    });
  });
});
```

- [ ] **Step 8: Kjør testene og se at de feiler**

Run: `npm test`
Expected: FAIL – `parseCampaignOfferFields is not a function` (eller «does not provide an export»).

- [ ] **Step 9: Implementer `parseCampaignOfferFields`**

Øverst i `app/lib/campaigns.server.ts`, etter eksisterende imports:

```ts
import {
  normalizeBadgeLayout,
  normalizeOfferType,
  offerIncludesDiscount,
  offerIncludesFreeShipping,
  type CampaignBadgeLayoutType,
  type CampaignOfferType,
} from "./campaign-offer";
```

Nederst i filen:

```ts
export type CampaignOfferFields = {
  offerType: CampaignOfferType;
  discountKind: DiscountKind | null;
  discountValue: number | null;
  freeShippingBadgeText: string | null;
  badgeLayout: CampaignBadgeLayoutType;
};

export function parseCampaignOfferFields(
  formData: FormData,
): { ok: true; fields: CampaignOfferFields } | { ok: false; error: string } {
  const offerType = normalizeOfferType(formData.get("offerType"));
  const includesDiscount = offerIncludesDiscount(offerType);
  const discountValue = Number(formData.get("discountValue") ?? 0);

  if (includesDiscount && (!Number.isFinite(discountValue) || discountValue <= 0)) {
    return { ok: false, error: "Enter a discount value greater than 0." };
  }

  const freeShippingBadgeText = String(formData.get("freeShippingBadgeText") ?? "").trim();

  return {
    ok: true,
    fields: {
      offerType,
      discountKind: includesDiscount ? normalizeDiscountKind(formData.get("discountKind")) : null,
      discountValue: includesDiscount ? discountValue : null,
      freeShippingBadgeText:
        offerIncludesFreeShipping(offerType) && freeShippingBadgeText
          ? freeShippingBadgeText
          : null,
      badgeLayout: normalizeBadgeLayout(formData.get("badgeLayout")),
    },
  };
}
```

- [ ] **Step 10: Kjør alle sjekker**

Run: `npm test`
Expected: PASS (9 tester).

Run: `npx tsc --noEmit`
Expected: ingen feil.

Run: `npm run lint`
Expected: ingen feil (bare den kjente advarselen om `@remix-run/eslint-config`).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json vitest.config.ts app/lib/campaign-offer.ts app/lib/campaign-offer.test.ts app/lib/campaigns.server.ts app/lib/campaigns.server.test.ts
git commit -m "Parse campaign offers so a campaign can carry free shipping"
```

---

### Task 2: Shopify-mutasjoner for fraktrabatten

**Files:**
- Create: `app/test/fake-admin.ts`
- Modify: `app/models/shopify-discounts.server.ts`
- Create: `app/models/shopify-discounts.server.test.ts`

**Interfaces:**
- Consumes: `ShippingFunctionConfiguration` fra `app/lib/campaign-offer.ts` (Task 1).
- Produces:
  - `createFakeAdmin(responses: unknown[]): { admin: { graphql(query, options?) => Promise<Response> }; calls: Array<{ query: string; variables?: Record<string, unknown> }> }` – svarer med neste element i `responses` per kall.
  - `createAutomaticDiscountInShopify` / `updateAutomaticDiscountInShopify` tar i tillegg `combinesWithShippingDiscounts?: boolean` (standard `false`).
  - `FREE_SHIPPING_FUNCTION_HANDLE = "discounto-free-shipping"`
  - `createShippingDiscountInShopify({ admin, title, configuration, startsAt?, endsAt? }): Promise<{ shopifyDiscountId: string }>`
  - `updateShippingDiscountInShopify({ admin, shopifyDiscountId, title, configuration, startsAt?, endsAt? }): Promise<{ shopifyDiscountId: string }>`
  - Eksisterende `deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId })` brukes også for app-rabatter (uendret).

Merk: `discountAutomaticAppUpdate` dokumenterer ikke om metafelt med samme namespace/key overskrives. Oppdatering skriver derfor konfigurasjonen med `metafieldsSet` (dokumentert upsert) etter selve rabattoppdateringen.

- [ ] **Step 1: Lag test-hjelperen `app/test/fake-admin.ts`**

```ts
export type FakeAdminCall = {
  query: string;
  variables?: Record<string, unknown>;
};

export function createFakeAdmin(responses: unknown[]) {
  const queue = [...responses];
  const calls: FakeAdminCall[] = [];

  const admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, variables: options?.variables });

      if (queue.length === 0) {
        throw new Error(`Unexpected Admin API call: ${query.trim().split("\n")[0]}`);
      }

      return new Response(JSON.stringify(queue.shift()));
    },
  };

  return { admin, calls };
}
```

- [ ] **Step 2: Skriv feilende tester**

`app/models/shopify-discounts.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "../test/fake-admin";
import {
  createAutomaticDiscountInShopify,
  createShippingDiscountInShopify,
  updateShippingDiscountInShopify,
} from "./shopify-discounts.server";

const configuration = {
  productIds: ["gid://shopify/Product/1"],
  collectionIds: [],
};

const basicCreated = {
  data: {
    discountAutomaticBasicCreate: {
      automaticDiscountNode: { id: "gid://shopify/DiscountAutomaticNode/10" },
      userErrors: [],
    },
  },
};

describe("createAutomaticDiscountInShopify", () => {
  it("keeps shipping discounts uncombinable by default", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated]);

    await createAutomaticDiscountInShopify({
      admin,
      title: "Summer",
      discountKind: "PERCENTAGE",
      discountValue: 10,
      selectedProducts: [{ productGid: "gid://shopify/Product/1" }],
    });

    const input = calls[0].variables?.automaticBasicDiscount as {
      combinesWith: { shippingDiscounts: boolean };
    };
    expect(input.combinesWith.shippingDiscounts).toBe(false);
  });

  it("lets the discount combine with shipping discounts when asked", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated]);

    await createAutomaticDiscountInShopify({
      admin,
      title: "Summer",
      discountKind: "PERCENTAGE",
      discountValue: 10,
      selectedProducts: [{ productGid: "gid://shopify/Product/1" }],
      combinesWithShippingDiscounts: true,
    });

    const input = calls[0].variables?.automaticBasicDiscount as {
      combinesWith: { shippingDiscounts: boolean };
    };
    expect(input.combinesWith.shippingDiscounts).toBe(true);
  });
});

describe("createShippingDiscountInShopify", () => {
  it("creates a shipping-only app discount carrying the function configuration", async () => {
    const { admin, calls } = createFakeAdmin([
      {
        data: {
          discountAutomaticAppCreate: {
            automaticAppDiscount: { discountId: "gid://shopify/DiscountAutomaticNode/20" },
            userErrors: [],
          },
        },
      },
    ]);

    const result = await createShippingDiscountInShopify({
      admin,
      title: "Summer",
      configuration,
      startsAt: new Date("2026-09-15T08:00:00.000Z"),
      endsAt: null,
    });

    expect(result).toEqual({ shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20" });
    expect(calls[0].query).toContain("discountAutomaticAppCreate");
    expect(calls[0].variables?.automaticAppDiscount).toEqual({
      title: "Summer",
      startsAt: "2026-09-15T08:00:00.000Z",
      functionHandle: "discounto-free-shipping",
      discountClasses: ["SHIPPING"],
      combinesWith: {
        orderDiscounts: false,
        productDiscounts: true,
        shippingDiscounts: false,
      },
      metafields: [
        {
          namespace: "$app",
          key: "function-configuration",
          type: "json",
          value: JSON.stringify(configuration),
        },
      ],
    });
  });

  it("throws Shopify's user error message", async () => {
    const { admin } = createFakeAdmin([
      {
        data: {
          discountAutomaticAppCreate: {
            automaticAppDiscount: null,
            userErrors: [{ message: "Maximum automatic discounts reached." }],
          },
        },
      },
    ]);

    await expect(
      createShippingDiscountInShopify({ admin, title: "Summer", configuration }),
    ).rejects.toThrow("Maximum automatic discounts reached.");
  });
});

describe("updateShippingDiscountInShopify", () => {
  it("updates the discount and then rewrites the configuration metafield", async () => {
    const { admin, calls } = createFakeAdmin([
      {
        data: {
          discountAutomaticAppUpdate: {
            automaticAppDiscount: { discountId: "gid://shopify/DiscountAutomaticNode/20" },
            userErrors: [],
          },
        },
      },
      {
        data: {
          metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/1" }], userErrors: [] },
        },
      },
    ]);

    const result = await updateShippingDiscountInShopify({
      admin,
      shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20",
      title: "Summer v2",
      configuration,
    });

    expect(result).toEqual({ shopifyDiscountId: "gid://shopify/DiscountAutomaticNode/20" });
    expect(calls[0].query).toContain("discountAutomaticAppUpdate");
    expect(calls[0].variables?.id).toBe("gid://shopify/DiscountAutomaticNode/20");
    expect(calls[0].variables?.automaticAppDiscount).not.toHaveProperty("functionHandle");
    expect(calls[1].query).toContain("metafieldsSet");
    expect(calls[1].variables?.metafields).toEqual([
      {
        ownerId: "gid://shopify/DiscountAutomaticNode/20",
        namespace: "$app",
        key: "function-configuration",
        type: "json",
        value: JSON.stringify(configuration),
      },
    ]);
  });
});
```

- [ ] **Step 3: Kjør testene og se at de feiler**

Run: `npm test -- app/models/shopify-discounts.server.test.ts`
Expected: FAIL – `createShippingDiscountInShopify` finnes ikke, og testen for `combinesWithShippingDiscounts: true` får `false`.

- [ ] **Step 4: Legg til `combinesWithShippingDiscounts` på basic-rabatten**

I `app/models/shopify-discounts.server.ts`:

1. Utvid `DiscountInput`:

```ts
type DiscountInput = {
  title: string;
  discountKind: DiscountKind;
  discountValue: number;
  selectedProducts: SelectedProduct[];
  selectedCollections?: SelectedCollection[];
  startsAt?: Date | null;
  endsAt?: Date | null;
  combinesWithShippingDiscounts?: boolean;
};
```

2. I både `buildCreateAutomaticBasicDiscountInput` og `buildUpdateAutomaticBasicDiscountInput`: legg `combinesWithShippingDiscounts,` til i destruktureringen og bytt

```ts
      shippingDiscounts: false,
```

med

```ts
      shippingDiscounts: combinesWithShippingDiscounts ?? false,
```

3. I både `createAutomaticDiscountInShopify` og `updateAutomaticDiscountInShopify`: legg `combinesWithShippingDiscounts,` til i destruktureringen og i objektet som sendes til `build…Input(...)`.

- [ ] **Step 5: Legg til mutasjonene for fraktrabatten**

Øverst i filen, etter eksisterende import:

```ts
import type { ShippingFunctionConfiguration } from "../lib/campaign-offer";
```

Etter `DELETE_AUTOMATIC_DISCOUNT_MUTATION`:

```ts
const CREATE_AUTOMATIC_APP_DISCOUNT_MUTATION = `#graphql
  mutation CreateAutomaticAppDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const UPDATE_AUTOMATIC_APP_DISCOUNT_MUTATION = `#graphql
  mutation UpdateAutomaticAppDiscount($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const SET_FUNCTION_CONFIGURATION_MUTATION = `#graphql
  mutation SetDiscountFunctionConfiguration($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

export const FREE_SHIPPING_FUNCTION_HANDLE = "discounto-free-shipping";
const FUNCTION_CONFIGURATION_NAMESPACE = "$app";
const FUNCTION_CONFIGURATION_KEY = "function-configuration";

// The shipping discount must stack with the campaign's own product discount.
const SHIPPING_DISCOUNT_COMBINES_WITH = {
  orderDiscounts: false,
  productDiscounts: true,
  shippingDiscounts: false,
};
```

Utvid signaturen og payload-typen i `parseDiscountMutationResponse` (resten av funksjonen er uendret):

```ts
async function parseDiscountMutationResponse(
  response: Response,
  payloadKey:
    | "discountAutomaticBasicCreate"
    | "discountAutomaticBasicUpdate"
    | "discountAutomaticDelete"
    | "discountAutomaticAppCreate"
    | "discountAutomaticAppUpdate"
    | "metafieldsSet",
) {
  const json = (await response.json()) as {
    errors?: Array<{ message?: string | null }>;
    data?: Record<
      string,
      | {
          automaticDiscountNode?: { id?: string | null } | null;
          automaticAppDiscount?: { discountId?: string | null } | null;
          deletedAutomaticDiscountId?: string | null;
          userErrors?: Array<{ message?: string | null }>;
        }
      | undefined
    >;
  };
```

Legg til nederst i filen:

```ts
type ShippingDiscountInput = {
  title: string;
  configuration: ShippingFunctionConfiguration;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

function buildShippingDiscountSchedule({
  title,
  startsAt,
  endsAt,
}: Pick<ShippingDiscountInput, "title" | "startsAt" | "endsAt">) {
  return {
    title,
    startsAt: (startsAt ?? new Date()).toISOString(),
    ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
  };
}

export async function createShippingDiscountInShopify({
  admin,
  title,
  configuration,
  startsAt,
  endsAt,
}: ShippingDiscountInput & {
  admin: AdminGraphqlClient;
}) {
  const response = await admin.graphql(CREATE_AUTOMATIC_APP_DISCOUNT_MUTATION, {
    variables: {
      automaticAppDiscount: {
        ...buildShippingDiscountSchedule({ title, startsAt, endsAt }),
        functionHandle: FREE_SHIPPING_FUNCTION_HANDLE,
        discountClasses: ["SHIPPING"],
        combinesWith: SHIPPING_DISCOUNT_COMBINES_WITH,
        metafields: [
          {
            namespace: FUNCTION_CONFIGURATION_NAMESPACE,
            key: FUNCTION_CONFIGURATION_KEY,
            type: "json",
            value: JSON.stringify(configuration),
          },
        ],
      },
    },
  });

  const payload = await parseDiscountMutationResponse(response, "discountAutomaticAppCreate");
  const shopifyDiscountId = payload?.automaticAppDiscount?.discountId;

  if (!shopifyDiscountId) {
    throw new Error("Shopify did not return a discount ID for the new free shipping discount.");
  }

  return {
    shopifyDiscountId,
  };
}

export async function updateShippingDiscountInShopify({
  admin,
  shopifyDiscountId,
  title,
  configuration,
  startsAt,
  endsAt,
}: ShippingDiscountInput & {
  admin: AdminGraphqlClient;
  shopifyDiscountId: string;
}) {
  const response = await admin.graphql(UPDATE_AUTOMATIC_APP_DISCOUNT_MUTATION, {
    variables: {
      id: shopifyDiscountId,
      automaticAppDiscount: {
        ...buildShippingDiscountSchedule({ title, startsAt, endsAt }),
        discountClasses: ["SHIPPING"],
        combinesWith: SHIPPING_DISCOUNT_COMBINES_WITH,
      },
    },
  });

  const payload = await parseDiscountMutationResponse(response, "discountAutomaticAppUpdate");
  const updatedDiscountId = payload?.automaticAppDiscount?.discountId;

  if (!updatedDiscountId) {
    throw new Error(
      "Shopify did not return a discount ID after updating the free shipping discount.",
    );
  }

  // discountAutomaticAppUpdate does not document overwriting metafields, so the
  // configuration is written with metafieldsSet, which upserts by namespace and key.
  const metafieldResponse = await admin.graphql(SET_FUNCTION_CONFIGURATION_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: updatedDiscountId,
          namespace: FUNCTION_CONFIGURATION_NAMESPACE,
          key: FUNCTION_CONFIGURATION_KEY,
          type: "json",
          value: JSON.stringify(configuration),
        },
      ],
    },
  });

  await parseDiscountMutationResponse(metafieldResponse, "metafieldsSet");

  return {
    shopifyDiscountId: updatedDiscountId,
  };
}
```

- [ ] **Step 6: Kjør alle sjekker**

Run: `npm test`
Expected: PASS (alle tester, inkl. 5 nye).

Run: `npx tsc --noEmit` og `npm run lint`
Expected: ingen feil.

- [ ] **Step 7: Commit**

```bash
git add app/test/fake-admin.ts app/models/shopify-discounts.server.ts app/models/shopify-discounts.server.test.ts
git commit -m "Create free shipping app discounts in Shopify"
```

---

### Task 3: Synk-modul for begge Shopify-rabattene

**Files:**
- Create: `app/models/campaign-discount-sync.server.ts`
- Create: `app/models/campaign-discount-sync.server.test.ts`

**Interfaces:**
- Consumes: `offerIncludesDiscount`, `offerIncludesFreeShipping`, `buildShippingFunctionConfiguration`, `CampaignOfferType` (Task 1); `createAutomaticDiscountInShopify`, `updateAutomaticDiscountInShopify` (med `combinesWithShippingDiscounts`), `createShippingDiscountInShopify`, `updateShippingDiscountInShopify`, `deleteAutomaticDiscountInShopify` (Task 2); `createFakeAdmin` (Task 2).
- Produces:
  - `CampaignDiscountIds = { shopifyDiscountId: string | null; shopifyShippingDiscountId: string | null }`
  - `class CampaignSyncError extends Error { readonly ids: CampaignDiscountIds }` – `ids` er beste kjente tilstand i Shopify etter feilen, og skal lagres på kampanjen.
  - `syncCampaignDiscountsInShopify({ admin, existingIds, title, offerType, discountKind, discountValue, selectedProducts, selectedCollections, discountProducts, startsAt?, endsAt? }): Promise<CampaignDiscountIds>`
    - `selectedProducts`/`selectedCollections`: kampanjens egne valg (brukes i Function-konfigurasjonen, og `selectedCollections` også i basic-rabatten).
    - `discountProducts`: produktlisten basic-rabatten skal få (rutene sender samme liste som i dag).
  - `deleteCampaignDiscountsInShopify({ admin, ids }): Promise<void>` – kaster `CampaignSyncError` med ID-ene som ikke ble slettet.

Regler (fra spec):
- Opprett eller oppdater delene kampanjen skal ha, **før** sletting av delene den ikke lenger skal ha.
- Basic-rabatten får `combinesWithShippingDiscounts: true` bare når kampanjen har fri frakt.
- Feiler et steg: slett rabatter som ble **opprettet** i samme kall, og kast `CampaignSyncError` med gjeldende ID-er.

- [ ] **Step 1: Skriv feilende tester**

`app/models/campaign-discount-sync.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeAdmin } from "../test/fake-admin";
import {
  CampaignSyncError,
  deleteCampaignDiscountsInShopify,
  syncCampaignDiscountsInShopify,
} from "./campaign-discount-sync.server";

const PRODUCT = "gid://shopify/Product/1";
const BASIC = "gid://shopify/DiscountAutomaticNode/10";
const SHIPPING = "gid://shopify/DiscountAutomaticNode/20";

const basicCreated = {
  data: {
    discountAutomaticBasicCreate: { automaticDiscountNode: { id: BASIC }, userErrors: [] },
  },
};
const basicUpdated = {
  data: {
    discountAutomaticBasicUpdate: { automaticDiscountNode: { id: BASIC }, userErrors: [] },
  },
};
const shippingCreated = {
  data: {
    discountAutomaticAppCreate: { automaticAppDiscount: { discountId: SHIPPING }, userErrors: [] },
  },
};
const shippingCreateFailed = {
  data: {
    discountAutomaticAppCreate: {
      automaticAppDiscount: null,
      userErrors: [{ message: "Maximum automatic discounts reached." }],
    },
  },
};
const deleted = (id: string) => ({
  data: { discountAutomaticDelete: { deletedAutomaticDiscountId: id, userErrors: [] } },
});
const deleteFailed = {
  data: {
    discountAutomaticDelete: {
      deletedAutomaticDiscountId: null,
      userErrors: [{ message: "Discount does not exist" }],
    },
  },
};

const noIds = { shopifyDiscountId: null, shopifyShippingDiscountId: null };
const campaign = {
  title: "Summer",
  discountKind: "PERCENTAGE" as const,
  discountValue: 10,
  selectedProducts: [{ productGid: PRODUCT }],
  selectedCollections: [],
  discountProducts: [{ productGid: PRODUCT }],
  startsAt: null,
  endsAt: null,
};

function basicInput(call: { variables?: Record<string, unknown> }) {
  return call.variables?.automaticBasicDiscount as { combinesWith: { shippingDiscounts: boolean } };
}

describe("syncCampaignDiscountsInShopify", () => {
  it("creates only the product discount for a discount campaign", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "DISCOUNT",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC, shopifyShippingDiscountId: null });
    expect(calls).toHaveLength(1);
    expect(basicInput(calls[0]).combinesWith.shippingDiscounts).toBe(false);
  });

  it("creates only the shipping discount for a free shipping campaign", async () => {
    const { admin, calls } = createFakeAdmin([shippingCreated]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "FREE_SHIPPING",
      ...campaign,
      discountKind: null,
      discountValue: null,
    });

    expect(ids).toEqual({ shopifyDiscountId: null, shopifyShippingDiscountId: SHIPPING });
    expect(calls).toHaveLength(1);
    const input = calls[0].variables?.automaticAppDiscount as {
      metafields: Array<{ value: string }>;
    };
    expect(JSON.parse(input.metafields[0].value)).toEqual({
      productIds: [PRODUCT],
      collectionIds: [],
    });
  });

  it("creates both discounts and lets them combine", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated, shippingCreated]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "DISCOUNT_AND_FREE_SHIPPING",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING });
    expect(basicInput(calls[0]).combinesWith.shippingDiscounts).toBe(true);
  });

  it("updates the product discount before deleting a shipping discount that is no longer wanted", async () => {
    const { admin, calls } = createFakeAdmin([basicUpdated, deleted(SHIPPING)]);

    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
      offerType: "DISCOUNT",
      ...campaign,
    });

    expect(ids).toEqual({ shopifyDiscountId: BASIC, shopifyShippingDiscountId: null });
    expect(calls[0].query).toContain("discountAutomaticBasicUpdate");
    expect(calls[1].query).toContain("discountAutomaticDelete");
    expect(calls[1].variables?.id).toBe(SHIPPING);
  });

  it("rolls back a discount it created when a later step fails", async () => {
    const { admin, calls } = createFakeAdmin([basicCreated, shippingCreateFailed, deleted(BASIC)]);

    const error = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: noIds,
      offerType: "DISCOUNT_AND_FREE_SHIPPING",
      ...campaign,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CampaignSyncError);
    expect((error as CampaignSyncError).message).toBe("Maximum automatic discounts reached.");
    expect((error as CampaignSyncError).ids).toEqual(noIds);
    expect(calls[2].query).toContain("discountAutomaticDelete");
    expect(calls[2].variables?.id).toBe(BASIC);
  });
});

describe("deleteCampaignDiscountsInShopify", () => {
  it("deletes both discounts", async () => {
    const { admin, calls } = createFakeAdmin([deleted(BASIC), deleted(SHIPPING)]);

    await deleteCampaignDiscountsInShopify({
      admin,
      ids: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
    });

    expect(calls.map((call) => call.variables?.id)).toEqual([BASIC, SHIPPING]);
  });

  it("reports the discounts that are still in Shopify when a delete fails", async () => {
    const { admin } = createFakeAdmin([deleted(BASIC), deleteFailed]);

    const error = await deleteCampaignDiscountsInShopify({
      admin,
      ids: { shopifyDiscountId: BASIC, shopifyShippingDiscountId: SHIPPING },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CampaignSyncError);
    expect((error as CampaignSyncError).ids).toEqual({
      shopifyDiscountId: null,
      shopifyShippingDiscountId: SHIPPING,
    });
  });
});
```

- [ ] **Step 2: Kjør testene og se at de feiler**

Run: `npm test -- app/models/campaign-discount-sync.server.test.ts`
Expected: FAIL – `Failed to resolve import "./campaign-discount-sync.server"`.

- [ ] **Step 3: Implementer `app/models/campaign-discount-sync.server.ts`**

```ts
import type { DiscountKind } from "@prisma/client";
import {
  buildShippingFunctionConfiguration,
  offerIncludesDiscount,
  offerIncludesFreeShipping,
  type CampaignOfferType,
} from "../lib/campaign-offer";
import {
  createAutomaticDiscountInShopify,
  createShippingDiscountInShopify,
  deleteAutomaticDiscountInShopify,
  updateAutomaticDiscountInShopify,
  updateShippingDiscountInShopify,
} from "./shopify-discounts.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

export type CampaignDiscountIds = {
  shopifyDiscountId: string | null;
  shopifyShippingDiscountId: string | null;
};

/**
 * Carries the discount IDs that exist in Shopify after a failed sync, so the
 * campaign row keeps pointing at real discounts instead of deleted ones.
 */
export class CampaignSyncError extends Error {
  readonly ids: CampaignDiscountIds;

  constructor(message: string, ids: CampaignDiscountIds) {
    super(message);
    this.name = "CampaignSyncError";
    this.ids = ids;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "An unexpected error stopped the Shopify discount sync.";
}

export async function syncCampaignDiscountsInShopify({
  admin,
  existingIds,
  title,
  offerType,
  discountKind,
  discountValue,
  selectedProducts,
  selectedCollections,
  discountProducts,
  startsAt,
  endsAt,
}: {
  admin: AdminGraphqlClient;
  existingIds: CampaignDiscountIds;
  title: string;
  offerType: CampaignOfferType;
  discountKind: DiscountKind | null;
  discountValue: number | null;
  selectedProducts: Array<{ productGid: string }>;
  selectedCollections: Array<{ collectionGid: string }>;
  discountProducts: Array<{ productGid: string }>;
  startsAt?: Date | null;
  endsAt?: Date | null;
}): Promise<CampaignDiscountIds> {
  const ids: CampaignDiscountIds = { ...existingIds };
  const created: Array<keyof CampaignDiscountIds> = [];
  const includesDiscount = offerIncludesDiscount(offerType);
  const includesFreeShipping = offerIncludesFreeShipping(offerType);

  try {
    if (includesDiscount) {
      if (discountKind == null || discountValue == null) {
        throw new Error("This campaign is missing its discount value.");
      }

      const discountInput = {
        admin,
        title,
        discountKind,
        discountValue,
        selectedProducts: discountProducts,
        selectedCollections,
        startsAt,
        endsAt,
        combinesWithShippingDiscounts: includesFreeShipping,
      };

      if (ids.shopifyDiscountId) {
        const result = await updateAutomaticDiscountInShopify({
          ...discountInput,
          shopifyDiscountId: ids.shopifyDiscountId,
        });
        ids.shopifyDiscountId = result.shopifyDiscountId;
      } else {
        const result = await createAutomaticDiscountInShopify(discountInput);
        ids.shopifyDiscountId = result.shopifyDiscountId;
        created.push("shopifyDiscountId");
      }
    }

    if (includesFreeShipping) {
      const shippingInput = {
        admin,
        title,
        configuration: buildShippingFunctionConfiguration({ selectedProducts, selectedCollections }),
        startsAt,
        endsAt,
      };

      if (ids.shopifyShippingDiscountId) {
        const result = await updateShippingDiscountInShopify({
          ...shippingInput,
          shopifyDiscountId: ids.shopifyShippingDiscountId,
        });
        ids.shopifyShippingDiscountId = result.shopifyDiscountId;
      } else {
        const result = await createShippingDiscountInShopify(shippingInput);
        ids.shopifyShippingDiscountId = result.shopifyDiscountId;
        created.push("shopifyShippingDiscountId");
      }
    }

    // Deletes run last so a failed create or update never strips the campaign
    // of the discount it had before this sync.
    if (!includesDiscount && ids.shopifyDiscountId) {
      await deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId: ids.shopifyDiscountId });
      ids.shopifyDiscountId = null;
    }

    if (!includesFreeShipping && ids.shopifyShippingDiscountId) {
      await deleteAutomaticDiscountInShopify({
        admin,
        shopifyDiscountId: ids.shopifyShippingDiscountId,
      });
      ids.shopifyShippingDiscountId = null;
    }

    return ids;
  } catch (error) {
    for (const key of created) {
      const shopifyDiscountId = ids[key];

      if (!shopifyDiscountId) {
        continue;
      }

      try {
        await deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId });
        ids[key] = null;
      } catch (rollbackError) {
        console.error("[discounto/sync] Could not roll back a discount created during a failed sync", {
          rollbackError,
          shopifyDiscountId,
        });
      }
    }

    throw new CampaignSyncError(getErrorMessage(error), ids);
  }
}

export async function deleteCampaignDiscountsInShopify({
  admin,
  ids,
}: {
  admin: AdminGraphqlClient;
  ids: CampaignDiscountIds;
}) {
  const remaining: CampaignDiscountIds = { ...ids };

  try {
    for (const key of ["shopifyDiscountId", "shopifyShippingDiscountId"] as const) {
      const shopifyDiscountId = remaining[key];

      if (!shopifyDiscountId) {
        continue;
      }

      await deleteAutomaticDiscountInShopify({ admin, shopifyDiscountId });
      remaining[key] = null;
    }
  } catch (error) {
    throw new CampaignSyncError(getErrorMessage(error), remaining);
  }
}
```

- [ ] **Step 4: Kjør alle sjekker**

Run: `npm test`
Expected: PASS (7 nye tester i `campaign-discount-sync.server.test.ts`).

Run: `npx tsc --noEmit` og `npm run lint`
Expected: ingen feil.

- [ ] **Step 5: Commit**

```bash
git add app/models/campaign-discount-sync.server.ts app/models/campaign-discount-sync.server.test.ts
git commit -m "Sync a campaign's product and shipping discounts together"
```

---

### Task 4: Database og ruter bruker offer og synk-modulen

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260914120000_add_campaign_free_shipping/migration.sql`
- Modify: `app/models/discount.server.ts`
- Modify: `app/routes/app.discounts.new.tsx`
- Modify: `app/routes/app.discounts.$campaignId.tsx`
- Modify: `app/routes/app.discounts._index.tsx`
- Modify: `app/routes/app._index.tsx`

**Interfaces:**
- Consumes: `parseCampaignOfferFields`, `CampaignOfferFields`, `formatCampaignOfferLabel`, `DEFAULT_FREE_SHIPPING_BADGE_TEXT`, `CampaignOfferType`, `CampaignBadgeLayoutType` (Task 1); `syncCampaignDiscountsInShopify`, `deleteCampaignDiscountsInShopify`, `CampaignSyncError`, `CampaignDiscountIds` (Task 3).
- Produces:
  - Prisma: `DiscountCampaign.offerType`, `.freeShippingBadgeText`, `.badgeLayout`, `.shopifyShippingDiscountId`; `discountKind`/`discountValue` nullable.
  - `CampaignRecord` med feltene over.
  - `createCampaign(input: {...eksisterende uten discountKind/discountValue} & CampaignOfferFields)`, `updateCampaign(input: {...} & CampaignOfferFields)`
  - `markCampaignSyncSuccess({ campaignId, ids: CampaignDiscountIds })`
  - `markCampaignActive({ campaignId, ids: CampaignDiscountIds })`
  - `markCampaignSyncFailure({ campaignId, errorMessage, ids?: CampaignDiscountIds })`
  - `markCampaignArchived({ campaignId })` nuller begge ID-ene.

Denne tasken endrer ikke editoren. Editoren sender ikke `offerType` før Task 5, så alle kampanjer lagres fortsatt som `DISCOUNT` – oppførselen er uendret.

- [ ] **Step 1: Oppdater Prisma-schemaet**

I `prisma/schema.prisma`, etter `enum CampaignSyncStatus { ... }`:

```prisma
enum CampaignOffer {
  DISCOUNT
  FREE_SHIPPING
  DISCOUNT_AND_FREE_SHIPPING
}

enum CampaignBadgeLayout {
  SEPARATE
  COMBINED
  DISCOUNT_ONLY
}
```

I `model DiscountCampaign`, bytt

```prisma
  discountKind      DiscountKind
  discountValue     Float
```

med

```prisma
  offerType                 CampaignOffer        @default(DISCOUNT)
  discountKind              DiscountKind?
  discountValue             Float?
```

og legg til etter `shopifyDiscountId String?`:

```prisma
  shopifyShippingDiscountId String?
  freeShippingBadgeText     String?
  badgeLayout               CampaignBadgeLayout  @default(SEPARATE)
```

Run: `npx prisma format`
Expected: `Formatted prisma\schema.prisma`.

- [ ] **Step 2: Skriv migreringen**

`prisma/migrations/20260914120000_add_campaign_free_shipping/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "CampaignOffer" AS ENUM ('DISCOUNT', 'FREE_SHIPPING', 'DISCOUNT_AND_FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "CampaignBadgeLayout" AS ENUM ('SEPARATE', 'COMBINED', 'DISCOUNT_ONLY');

-- AlterTable
ALTER TABLE "DiscountCampaign" ADD COLUMN     "badgeLayout" "CampaignBadgeLayout" NOT NULL DEFAULT 'SEPARATE',
ADD COLUMN     "freeShippingBadgeText" TEXT,
ADD COLUMN     "offerType" "CampaignOffer" NOT NULL DEFAULT 'DISCOUNT',
ADD COLUMN     "shopifyShippingDiscountId" TEXT,
ALTER COLUMN "discountKind" DROP NOT NULL,
ALTER COLUMN "discountValue" DROP NOT NULL;
```

Eksisterende rader får `offerType = 'DISCOUNT'` og beholder verdiene sine.

- [ ] **Step 3: Generer Prisma-klienten og valider schemaet**

Run: `npx prisma generate`
Expected: `Generated Prisma Client`.

Run (Git Bash): `DATABASE_URL="postgresql://user:pass@localhost:5432/discounto" npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid`.

Hvis du har en lokal database i `DATABASE_URL`: kjør også `npx prisma migrate deploy` og deretter `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`. Expected: exit code 0 (migreringen matcher schemaet).

Run: `npx tsc --noEmit`
Expected: FAIL – feil i `discount.server.ts` og rutene fordi `discountKind`/`discountValue` kan være `null`. Det rettes i stegene under.

- [ ] **Step 4: Oppdater `app/models/discount.server.ts`**

Bytt import-linjen øverst:

```ts
import type { DiscountKind } from "@prisma/client";
import prisma from "../db.server";
import type { CampaignBadgeLayoutType, CampaignOfferType } from "../lib/campaign-offer";
import type { CampaignOfferFields } from "../lib/campaigns.server";
import type { CampaignDiscountIds } from "./campaign-discount-sync.server";
```

I `CampaignRecord`, bytt

```ts
  discountKind: DiscountKind;
  discountValue: number;
```

med

```ts
  offerType: CampaignOfferType;
  discountKind: DiscountKind | null;
  discountValue: number | null;
  freeShippingBadgeText: string | null;
  badgeLayout: CampaignBadgeLayoutType;
```

og legg til etter `shopifyDiscountId: string | null;`:

```ts
  shopifyShippingDiscountId: string | null;
```

Bytt hele `createCampaign`:

```ts
export async function createCampaign({
  shop,
  title,
  offerType,
  discountKind,
  discountValue,
  freeShippingBadgeText,
  badgeLayout,
  currencyCode,
  badgeText,
  selectedProducts,
  selectedCollections,
  startsAt,
  endsAt,
}: CampaignOfferFields & {
  shop: string;
  title: string;
  currencyCode?: string | null;
  badgeText: string | null;
  selectedProducts: SelectedProductInput[];
  selectedCollections: SelectedCollectionInput[];
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  return (await prisma.discountCampaign.create({
    data: {
      shop,
      title,
      status: "DRAFT",
      syncStatus: "DRAFT",
      offerType,
      discountKind,
      discountValue,
      freeShippingBadgeText,
      badgeLayout,
      currencyCode: currencyCode ?? "USD",
      badgeText,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      products: {
        create: selectedProducts.map((product) => ({
          productGid: product.productGid,
          productTitle: product.productTitle ?? null,
          productHandle: product.productHandle ?? null,
          imageUrl: product.imageUrl ?? null,
        })),
      },
      collections: {
        create: selectedCollections.map((collection) => ({
          collectionGid: collection.collectionGid,
          collectionTitle: collection.collectionTitle ?? null,
          collectionHandle: collection.collectionHandle ?? null,
          imageUrl: collection.imageUrl ?? null,
        })),
      },
    },
    include: {
      products: true,
      collections: true,
    },
  } as never)) as CampaignRecord;
}
```

Bytt hele `updateCampaign`:

```ts
export async function updateCampaign({
  campaignId,
  shop,
  title,
  offerType,
  discountKind,
  discountValue,
  freeShippingBadgeText,
  badgeLayout,
  currencyCode,
  badgeText,
  selectedProducts,
  selectedCollections,
  startsAt,
  endsAt,
}: CampaignOfferFields & {
  campaignId: string;
  shop: string;
  title: string;
  currencyCode?: string | null;
  badgeText: string | null;
  selectedProducts: SelectedProductInput[];
  selectedCollections: SelectedCollectionInput[];
  startsAt?: Date | null;
  endsAt?: Date | null;
}) {
  return (await prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      title,
      offerType,
      discountKind,
      discountValue,
      freeShippingBadgeText,
      badgeLayout,
      currencyCode: currencyCode ?? "USD",
      badgeText,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      lastSyncError: null,
      products: {
        deleteMany: {},
        create: selectedProducts.map((product) => ({
          productGid: product.productGid,
          productTitle: product.productTitle ?? null,
          productHandle: product.productHandle ?? null,
          imageUrl: product.imageUrl ?? null,
        })),
      },
      collections: {
        deleteMany: {},
        create: selectedCollections.map((collection) => ({
          collectionGid: collection.collectionGid,
          collectionTitle: collection.collectionTitle ?? null,
          collectionHandle: collection.collectionHandle ?? null,
          imageUrl: collection.imageUrl ?? null,
        })),
      },
    },
    include: {
      products: true,
      collections: true,
    },
  } as never)) as CampaignRecord;
}
```

Bytt `markCampaignSyncSuccess`, `markCampaignSyncFailure`, `markCampaignArchived` og `markCampaignActive`:

```ts
export async function markCampaignSyncSuccess({
  campaignId,
  ids,
}: {
  campaignId: string;
  ids: CampaignDiscountIds;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
      syncStatus: "SYNCED",
      shopifyDiscountId: ids.shopifyDiscountId,
      shopifyShippingDiscountId: ids.shopifyShippingDiscountId,
      lastSyncError: null,
    },
  });
}

export async function markCampaignSyncFailure({
  campaignId,
  errorMessage,
  ids,
}: {
  campaignId: string;
  errorMessage: string;
  ids?: CampaignDiscountIds;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "DRAFT",
      syncStatus: "SYNC_FAILED",
      lastSyncError: errorMessage,
      ...(ids
        ? {
            shopifyDiscountId: ids.shopifyDiscountId,
            shopifyShippingDiscountId: ids.shopifyShippingDiscountId,
          }
        : {}),
    },
  });
}

export async function markCampaignArchived({
  campaignId,
}: {
  campaignId: string;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "ARCHIVED",
      syncStatus: "DRAFT",
      shopifyDiscountId: null,
      shopifyShippingDiscountId: null,
      lastSyncError: null,
    },
  });
}

export async function markCampaignActive({
  campaignId,
  ids,
}: {
  campaignId: string;
  ids: CampaignDiscountIds;
}) {
  return prisma.discountCampaign.update({
    where: { id: campaignId },
    data: {
      status: "ACTIVE",
      syncStatus: "SYNCED",
      shopifyDiscountId: ids.shopifyDiscountId,
      shopifyShippingDiscountId: ids.shopifyShippingDiscountId,
      lastSyncError: null,
    },
  });
}
```

- [ ] **Step 5: Oppdater `app/routes/app.discounts.new.tsx`**

Bytt importene

```ts
import { createAutomaticDiscountInShopify } from "../models/shopify-discounts.server";
```

med

```ts
import {
  CampaignSyncError,
  syncCampaignDiscountsInShopify,
} from "../models/campaign-discount-sync.server";
```

og i importen fra `../lib/campaigns.server`, bytt `normalizeDiscountKind,` med `parseCampaignOfferFields,`.

I `action`, bytt

```ts
  const discountKind = normalizeDiscountKind(formData.get("discountKind"));
  const discountValue = Number(formData.get("discountValue") ?? 0);
```

med

```ts
  const offer = parseCampaignOfferFields(formData);
```

og bytt

```ts
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return { error: "Enter a discount value greater than 0." } satisfies ActionData;
  }
```

med

```ts
  if (!offer.ok) {
    return { error: offer.error } satisfies ActionData;
  }
```

Bytt `createCampaign({...})`-kallet:

```ts
  const campaign = await createCampaign({
    shop: session.shop,
    title,
    ...offer.fields,
    currencyCode,
    badgeText: badgeText || null,
    selectedProducts,
    selectedCollections,
    startsAt,
    endsAt,
  });
```

Bytt hele `try { ... } catch (error) { ... }` nederst i `action`:

```ts
  try {
    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: { shopifyDiscountId: null, shopifyShippingDiscountId: null },
      title,
      offerType: campaign.offerType,
      discountKind: campaign.discountKind,
      discountValue: campaign.discountValue,
      selectedProducts,
      selectedCollections,
      discountProducts: resolvedProducts,
      startsAt,
      endsAt,
    });

    await markCampaignSyncSuccess({
      campaignId: campaign.id,
      ids,
    });

    return redirect("/app/discounts");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error stopped the Shopify discount sync.";

    await markCampaignSyncFailure({
      campaignId: campaign.id,
      errorMessage: message,
      ids: error instanceof CampaignSyncError ? error.ids : undefined,
    });

    return {
      error: `The campaign was saved locally, but Shopify discount sync failed: ${message}`,
    } satisfies ActionData;
  }
```

- [ ] **Step 6: Oppdater `app/routes/app.discounts.$campaignId.tsx`**

Bytt importen

```ts
import {
  createAutomaticDiscountInShopify,
  updateAutomaticDiscountInShopify,
} from "../models/shopify-discounts.server";
```

med

```ts
import {
  CampaignSyncError,
  syncCampaignDiscountsInShopify,
} from "../models/campaign-discount-sync.server";
```

og i importen fra `../lib/campaigns.server`, bytt `normalizeDiscountKind,` med `parseCampaignOfferFields,`.

I `loader`, bytt

```ts
      discountKind: campaign.discountKind,
      discountValue: String(campaign.discountValue),
```

med

```ts
      discountKind: campaign.discountKind ?? undefined,
      discountValue: campaign.discountValue == null ? undefined : String(campaign.discountValue),
```

I `action`: gjør de samme to byttene som i Step 5 (`offer = parseCampaignOfferFields(formData)` og `if (!offer.ok)`). Bytt `updateCampaign({...})`-kallet:

```ts
  const campaign = await updateCampaign({
    campaignId,
    shop: session.shop,
    title,
    ...offer.fields,
    currencyCode,
    badgeText: badgeText || null,
    selectedProducts,
    selectedCollections,
    startsAt,
    endsAt,
  });
```

Bytt hele `try { ... } catch (error) { ... }` nederst i `action`:

```ts
  try {
    const ids = await syncCampaignDiscountsInShopify({
      admin,
      existingIds: {
        shopifyDiscountId: existingCampaign.shopifyDiscountId,
        shopifyShippingDiscountId: existingCampaign.shopifyShippingDiscountId,
      },
      title,
      offerType: campaign.offerType,
      discountKind: campaign.discountKind,
      discountValue: campaign.discountValue,
      selectedProducts,
      selectedCollections,
      discountProducts: resolvedProducts,
      startsAt,
      endsAt,
    });

    await markCampaignSyncSuccess({
      campaignId: campaign.id,
      ids,
    });

    return redirect("/app/discounts");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error stopped the Shopify discount sync.";

    await markCampaignSyncFailure({
      campaignId: campaign.id,
      errorMessage: message,
      ids: error instanceof CampaignSyncError ? error.ids : undefined,
    });

    return {
      error: `The campaign was updated locally, but Shopify discount sync failed: ${message}`,
    } satisfies ActionData;
  }
```

- [ ] **Step 7: Oppdater `app/routes/app.discounts._index.tsx`**

Bytt importen

```ts
import {
  createAutomaticDiscountInShopify,
  deleteAutomaticDiscountInShopify,
} from "../models/shopify-discounts.server";
```

med

```ts
import {
  CampaignSyncError,
  deleteCampaignDiscountsInShopify,
  syncCampaignDiscountsInShopify,
} from "../models/campaign-discount-sync.server";
import {
  DEFAULT_FREE_SHIPPING_BADGE_TEXT,
  formatCampaignOfferLabel,
} from "../lib/campaign-offer";
```

I `loader`, bytt

```ts
      kind: campaign.discountKind,
      value: campaign.discountValue,
      currencyCode: campaign.currencyCode,
```

med

```ts
      offerLabel: formatCampaignOfferLabel({
        offerType: campaign.offerType,
        discountKind: campaign.discountKind,
        discountValue: campaign.discountValue,
        currencyCode: campaign.currencyCode,
      }),
```

og bytt

```ts
      badgeText: campaign.badgeText,
```

med

```ts
      badgeText:
        campaign.offerType === "FREE_SHIPPING"
          ? campaign.freeShippingBadgeText ?? DEFAULT_FREE_SHIPPING_BADGE_TEXT
          : campaign.badgeText,
```

I `action`, legg til rett etter `const campaigns = await listCampaignsForShop(session.shop);`:

```ts
  const existingIds = {
    shopifyDiscountId: campaign.shopifyDiscountId,
    shopifyShippingDiscountId: campaign.shopifyShippingDiscountId,
  };
```

Bytt `deactivate`-blokken:

```ts
    if (intent === "deactivate") {
      await deleteCampaignDiscountsInShopify({ admin, ids: existingIds });
      await markCampaignArchived({ campaignId });
      return redirect("/app/discounts");
    }
```

I `activate`-blokken, bytt fra `const { shopifyDiscountId } = await createAutomaticDiscountInShopify({` til og med `return redirect("/app/discounts");` med:

```ts
      const ids = await syncCampaignDiscountsInShopify({
        admin,
        existingIds,
        title: campaign.title,
        offerType: campaign.offerType,
        discountKind: campaign.discountKind,
        discountValue: campaign.discountValue,
        selectedProducts: campaign.products,
        selectedCollections: campaign.collections,
        discountProducts: shopifyDiscountProducts,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      });

      await markCampaignActive({
        campaignId,
        ids,
      });
      return redirect("/app/discounts");
```

Bytt `delete`-blokken:

```ts
    if (intent === "delete") {
      await deleteCampaignDiscountsInShopify({ admin, ids: existingIds });
      await deleteCampaignById({
        campaignId,
        shop: session.shop,
      });
      return redirect("/app/discounts");
    }
```

Bytt `markCampaignSyncFailure`-kallet i `catch`:

```ts
    await markCampaignSyncFailure({
      campaignId,
      errorMessage: message,
      ids: error instanceof CampaignSyncError ? error.ids : undefined,
    });
```

I tabellen: bytt overskriften `"Discount",` med `"Offer",` og bytt cellen

```tsx
                campaign.kind === "PERCENTAGE"
                  ? `${String(campaign.value)}%`
                  : `${String(campaign.value)} ${campaign.currencyCode}`,
```

med

```tsx
                campaign.offerLabel,
```

- [ ] **Step 8: Oppdater `app/routes/app._index.tsx`**

Legg til import:

```ts
import { formatCampaignOfferLabel } from "../lib/campaign-offer";
```

Bytt

```ts
      discountLabel:
        campaign.discountKind === "PERCENTAGE"
          ? `${campaign.discountValue}%`
          : `${campaign.discountValue} ${campaign.currencyCode}`,
```

med

```ts
      discountLabel: formatCampaignOfferLabel({
        offerType: campaign.offerType,
        discountKind: campaign.discountKind,
        discountValue: campaign.discountValue,
        currencyCode: campaign.currencyCode,
      }),
```

- [ ] **Step 9: Kjør alle sjekker**

Run: `npx tsc --noEmit`
Expected: ingen feil. Gjenstår feil som nevner `discountKind`/`discountValue`, søk etter dem med `grep -rn "discountKind\|discountValue" app --include=*.ts --include=*.tsx` og rett etter samme mønster.

Run: `npm test` og `npm run lint`
Expected: PASS / ingen feil.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260914120000_add_campaign_free_shipping app/models/discount.server.ts app/routes/app.discounts.new.tsx "app/routes/app.discounts.\$campaignId.tsx" app/routes/app.discounts._index.tsx app/routes/app._index.tsx
git commit -m "Store campaign offers and sync both Shopify discounts"
```

---

### Task 5: Offer-felt i kampanje-editoren

**Files:**
- Modify: `app/components/CampaignEditor.tsx`
- Modify: `app/routes/app.discounts.$campaignId.tsx` (loader sender nye felt)

**Interfaces:**
- Consumes: `CampaignOfferType`, `CampaignBadgeLayoutType`, `DEFAULT_FREE_SHIPPING_BADGE_TEXT`, `offerIncludesDiscount`, `offerIncludesFreeShipping` (Task 1). Skjemafeltene `offerType`, `freeShippingBadgeText`, `badgeLayout` leses av `parseCampaignOfferFields` (Task 1), som rutene bruker (Task 4).
- Produces: `CampaignEditor` sin `initialValues` godtar `offerType?`, `freeShippingBadgeText?`, `badgeLayout?`.

Felt som skjules, rendres ikke og sendes derfor ikke med skjemaet. `parseCampaignOfferFields` håndterer manglende felt.

- [ ] **Step 1: Importer offer-hjelperne**

I `app/components/CampaignEditor.tsx`, etter `import type { PlanDefinition, PlanTier } from "../lib/plans";`:

```ts
import {
  DEFAULT_FREE_SHIPPING_BADGE_TEXT,
  offerIncludesDiscount,
  offerIncludesFreeShipping,
  type CampaignBadgeLayoutType,
  type CampaignOfferType,
} from "../lib/campaign-offer";
```

- [ ] **Step 2: Utvid `initialValues`-typen**

I `CampaignEditorProps["initialValues"]`, etter `title?: string;`:

```ts
    offerType?: CampaignOfferType;
    freeShippingBadgeText?: string;
    badgeLayout?: CampaignBadgeLayoutType;
```

- [ ] **Step 3: Legg til state**

Etter `const [title, setTitle] = useState(initialValues?.title ?? "");`:

```ts
  const [offerType, setOfferType] = useState<CampaignOfferType>(
    initialValues?.offerType ?? "DISCOUNT",
  );
  const [freeShippingBadgeText, setFreeShippingBadgeText] = useState(
    initialValues?.freeShippingBadgeText || DEFAULT_FREE_SHIPPING_BADGE_TEXT,
  );
  const [badgeLayout, setBadgeLayout] = useState<CampaignBadgeLayoutType>(
    initialValues?.badgeLayout ?? "SEPARATE",
  );
  const includesDiscount = offerIncludesDiscount(offerType);
  const includesFreeShipping = offerIncludesFreeShipping(offerType);
```

- [ ] **Step 4: Legg til Offer-feltet og gjør rabattfeltene betingede**

Bytt blokken fra `<InlineStack gap="300" align="start">` (den med «Discount type») til og med `TextField` for «Badge text» (slutter med `helpText="This text is used by Discounto for storefront badges."\n              />`) med:

```tsx
              <Select
                label="Offer"
                name="offerType"
                value={offerType}
                onChange={(value) =>
                  setOfferType(
                    value === "FREE_SHIPPING" || value === "DISCOUNT_AND_FREE_SHIPPING"
                      ? value
                      : "DISCOUNT",
                  )
                }
                options={[
                  { label: "Discount", value: "DISCOUNT" },
                  { label: "Free shipping", value: "FREE_SHIPPING" },
                  { label: "Discount + free shipping", value: "DISCOUNT_AND_FREE_SHIPPING" },
                ]}
                helpText={
                  includesFreeShipping
                    ? "Free shipping applies to the whole order when the cart contains a product from this campaign."
                    : undefined
                }
              />

              {includesDiscount ? (
                <>
                  <InlineStack gap="300" align="start">
                    <div style={{ minWidth: 240 }}>
                      <Select
                        label="Discount type"
                        name="discountKind"
                        value={discountKind}
                        onChange={(value) =>
                          setDiscountKind(
                            value === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE",
                          )
                        }
                        options={[
                          { label: "Percentage", value: "PERCENTAGE" },
                          { label: "Fixed amount", value: "FIXED_AMOUNT" },
                        ]}
                      />
                    </div>
                    <div style={{ minWidth: 240 }}>
                      <TextField
                        label={discountKind === "FIXED_AMOUNT" ? "Amount off" : "Percent off"}
                        name="discountValue"
                        type="number"
                        value={discountValue}
                        onChange={setDiscountValue}
                        autoComplete="off"
                      />
                    </div>
                  </InlineStack>

                  <TextField
                    label="Badge text"
                    name="badgeText"
                    value={badgeText}
                    onChange={(value) => {
                      setBadgeTextTouched(true);
                      setBadgeText(value);
                    }}
                    autoComplete="off"
                    helpText="This text is used by Discounto for storefront badges."
                  />
                </>
              ) : null}

              {includesFreeShipping ? (
                <TextField
                  label="Free shipping badge text"
                  name="freeShippingBadgeText"
                  value={freeShippingBadgeText}
                  onChange={setFreeShippingBadgeText}
                  autoComplete="off"
                  helpText="Shown on campaign products, for example “Fri frakt”."
                />
              ) : null}

              {offerType === "DISCOUNT_AND_FREE_SHIPPING" ? (
                <Select
                  label="Badge display"
                  name="badgeLayout"
                  value={badgeLayout}
                  onChange={(value) =>
                    setBadgeLayout(
                      value === "COMBINED" || value === "DISCOUNT_ONLY" ? value : "SEPARATE",
                    )
                  }
                  options={[
                    { label: "Two separate badges", value: "SEPARATE" },
                    { label: "One combined badge", value: "COMBINED" },
                    { label: "Discount badge only", value: "DISCOUNT_ONLY" },
                  ]}
                  helpText="Where the free shipping badge sits is set in the theme editor."
                />
              ) : null}
```

- [ ] **Step 5: Send nye felt fra edit-loaderen**

I `app/routes/app.discounts.$campaignId.tsx`, i `loader` sitt `campaign`-objekt, etter `title: campaign.title,`:

```ts
      offerType: campaign.offerType,
      freeShippingBadgeText: campaign.freeShippingBadgeText ?? "",
      badgeLayout: campaign.badgeLayout,
```

- [ ] **Step 6: Kjør sjekker**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test`
Expected: ingen feil / PASS.

- [ ] **Step 7: Manuell sjekk av editoren**

Run: `npm run dev` og åpne appen i dev-butikken → Discounts → Create discount.

Expected:
- «Offer = Discount»: skjemaet ser ut som før (Discount type, verdi, Badge text), ingen fraktfelt.
- «Free shipping»: rabattfelt og Badge text forsvinner, «Free shipping badge text» vises med «Free shipping».
- «Discount + free shipping»: alle felt vises, pluss «Badge display».
- Lagre en kampanje med «Discount + free shipping»: den vises i listen med Offer «10% + free shipping». Åpne den igjen: valgene er beholdt.

(Selve fraktrabatten i Shopify krever Functionen fra Task 6. Før den er deployet feiler synken for kampanjer med fri frakt med en melding om ukjent function handle – det er forventet her.)

- [ ] **Step 8: Commit**

```bash
git add app/components/CampaignEditor.tsx "app/routes/app.discounts.\$campaignId.tsx"
git commit -m "Let merchants choose free shipping in the campaign editor"
```

---

### Task 6: Shopify Function for fri frakt

**Files:**
- Create: `extensions/discounto-free-shipping/shopify.extension.toml`
- Create: `extensions/discounto-free-shipping/package.json`
- Create: `extensions/discounto-free-shipping/vite.config.js`
- Create: `extensions/discounto-free-shipping/locales/en.default.json`
- Create: `extensions/discounto-free-shipping/src/index.js`
- Create: `extensions/discounto-free-shipping/src/cart_delivery_options_discounts_generate_run.graphql`
- Create: `extensions/discounto-free-shipping/src/cart_delivery_options_discounts_generate_run.js`
- Create: `extensions/discounto-free-shipping/src/cart_delivery_options_discounts_generate_run.test.js`
- Create: `extensions/discounto-free-shipping/tests/fixtures/campaign-product-in-cart.json`
- Create (generert): `extensions/discounto-free-shipping/schema.graphql`
- Modify: `shopify.app.toml` (metafelt-definisjon)
- Modify: `package.json` (root `test` kjører også Function-testene)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: metafeltet `$app` / `function-configuration` med JSON `{ "productIds": string[], "collectionIds": string[] }`, skrevet av `createShippingDiscountInShopify` / `updateShippingDiscountInShopify` (Task 2). `collectionIds` brukes som input-variabel, `productIds` leses i koden.
- Produces: Function med handle `discounto-free-shipping` og eksport `cart-delivery-options-discounts-generate-run` (JS-navn `cartDeliveryOptionsDiscountsGenerateRun(input)`), som Task 2 refererer til via `FREE_SHIPPING_FUNCTION_HANDLE`.

Strukturen følger Shopifys JavaScript-mal for discount-Functions (`Shopify/function-examples`, `discounts/javascript/discount/default`), med bare fraktmålet.

- [ ] **Step 1: Lag extension-konfigurasjonen**

`extensions/discounto-free-shipping/shopify.extension.toml`:

```toml
api_version = "2026-07"

[[extensions]]
name = "t:name"
handle = "discounto-free-shipping"
type = "function"
description = "t:description"

  [[extensions.targeting]]
  target = "cart.delivery-options.discounts.generate.run"
  input_query = "src/cart_delivery_options_discounts_generate_run.graphql"
  export = "cart-delivery-options-discounts-generate-run"

  [extensions.build]
  command = ""
  path = "dist/function.wasm"

  [extensions.input.variables]
  namespace = "$app"
  key = "function-configuration"
```

`extensions/discounto-free-shipping/locales/en.default.json`:

```json
{
  "name": "Discounto free shipping",
  "description": "Free shipping on the whole order when the cart contains a Discounto campaign product."
}
```

`extensions/discounto-free-shipping/package.json`:

```json
{
  "name": "discounto-free-shipping",
  "version": "0.0.1",
  "license": "UNLICENSED",
  "scripts": {
    "shopify": "npm exec -- shopify",
    "typegen": "npm exec -- shopify app function typegen",
    "build": "npm exec -- shopify app function build",
    "preview": "npm exec -- shopify app function run",
    "test": "vitest run"
  },
  "codegen": {
    "schema": "schema.graphql",
    "documents": "src/*.graphql",
    "generates": {
      "./generated/api.ts": {
        "plugins": [
          "typescript",
          "typescript-operations"
        ]
      }
    },
    "config": {
      "omitOperationSuffix": true
    }
  },
  "devDependencies": {
    "vitest": "3.2.7"
  },
  "dependencies": {
    "@shopify/shopify_function": "2.0.1"
  }
}
```

`extensions/discounto-free-shipping/vite.config.js`:

```js
// Prevents inheritance from the parent Remix project's vite.config.ts.
export default {};
```

`extensions/discounto-free-shipping/src/index.js`:

```js
export * from "./cart_delivery_options_discounts_generate_run";
```

`extensions/discounto-free-shipping/src/cart_delivery_options_discounts_generate_run.graphql`:

```graphql
query Input($collectionIds: [ID!]) {
  cart {
    lines {
      merchandise {
        __typename
        ... on ProductVariant {
          product {
            id
            inAnyCollection(ids: $collectionIds)
          }
        }
      }
    }
    deliveryGroups {
      deliveryOptions {
        handle
      }
    }
  }
  discount {
    discountClasses
    metafield(namespace: "$app", key: "function-configuration") {
      jsonValue
    }
  }
}
```

Legg til nederst i root-`.gitignore`:

```
/extensions/*/generated
```

- [ ] **Step 2: Installer workspace-avhengighetene**

Root `package.json` har allerede `"workspaces": { "packages": ["extensions/*"] }`.

Run: `npm install`
Expected: fullfører uten feil; `package-lock.json` får en `extensions/discounto-free-shipping`-oppføring.

- [ ] **Step 3: Skriv feilende tester**

`extensions/discounto-free-shipping/src/cart_delivery_options_discounts_generate_run.test.js`:

```js
import { describe, expect, it } from "vitest";
import { cartDeliveryOptionsDiscountsGenerateRun } from "./cart_delivery_options_discounts_generate_run";

const CAMPAIGN_PRODUCT = "gid://shopify/Product/1";
const OTHER_PRODUCT = "gid://shopify/Product/2";

function variantLine(productId, inAnyCollection = false) {
  return {
    merchandise: {
      __typename: "ProductVariant",
      product: { id: productId, inAnyCollection },
    },
  };
}

function buildInput({
  lines,
  deliveryOptions = ["standard", "express"],
  discountClasses = ["SHIPPING"],
  metafield = { jsonValue: { productIds: [CAMPAIGN_PRODUCT], collectionIds: [] } },
}) {
  return {
    cart: {
      lines,
      deliveryGroups: [{ deliveryOptions: deliveryOptions.map((handle) => ({ handle })) }],
    },
    discount: { discountClasses, metafield },
  };
}

const NO_CHANGES = { operations: [] };

describe("cartDeliveryOptionsDiscountsGenerateRun", () => {
  it("makes every delivery option free when the cart holds a campaign product", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      buildInput({ lines: [variantLine(OTHER_PRODUCT), variantLine(CAMPAIGN_PRODUCT)] }),
    );

    expect(result).toEqual({
      operations: [
        {
          deliveryDiscountsAdd: {
            candidates: [
              {
                message: "Free shipping",
                targets: [
                  { deliveryOption: { handle: "standard" } },
                  { deliveryOption: { handle: "express" } },
                ],
                value: { percentage: { value: 100 } },
              },
            ],
            selectionStrategy: "ALL",
          },
        },
      ],
    });
  });

  it("qualifies a product through a campaign collection", () => {
    const result = cartDeliveryOptionsDiscountsGenerateRun(
      buildInput({
        lines: [variantLine(OTHER_PRODUCT, true)],
        metafield: { jsonValue: { productIds: [], collectionIds: ["gid://shopify/Collection/9"] } },
      }),
    );

    expect(result.operations).toHaveLength(1);
  });

  it("leaves shipping alone when no line belongs to the campaign", () => {
    expect(
      cartDeliveryOptionsDiscountsGenerateRun(
        buildInput({ lines: [variantLine(OTHER_PRODUCT), { merchandise: { __typename: "CustomProduct" } }] }),
      ),
    ).toEqual(NO_CHANGES);
  });

  it("does nothing when the configuration metafield is missing", () => {
    expect(
      cartDeliveryOptionsDiscountsGenerateRun(
        buildInput({ lines: [variantLine(CAMPAIGN_PRODUCT)], metafield: null }),
      ),
    ).toEqual(NO_CHANGES);
  });

  it("does nothing when there are no delivery options", () => {
    expect(
      cartDeliveryOptionsDiscountsGenerateRun(
        buildInput({ lines: [variantLine(CAMPAIGN_PRODUCT)], deliveryOptions: [] }),
      ),
    ).toEqual(NO_CHANGES);
  });

  it("does nothing for a discount without the shipping class", () => {
    expect(
      cartDeliveryOptionsDiscountsGenerateRun(
        buildInput({ lines: [variantLine(CAMPAIGN_PRODUCT)], discountClasses: ["PRODUCT"] }),
      ),
    ).toEqual(NO_CHANGES);
  });
});
```

- [ ] **Step 4: Kjør testene og se at de feiler**

Run: `npm test --workspace discounto-free-shipping`
Expected: FAIL – `Failed to resolve import "./cart_delivery_options_discounts_generate_run"`.

- [ ] **Step 5: Implementer Functionen**

`extensions/discounto-free-shipping/src/cart_delivery_options_discounts_generate_run.js`:

```js
const NO_CHANGES = { operations: [] };
const FREE_SHIPPING_MESSAGE = "Free shipping";

export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  // Shopify requires functions to only return operations for the discount's classes.
  if (!input.discount.discountClasses.includes("SHIPPING")) {
    return NO_CHANGES;
  }

  const configuration = input.discount.metafield?.jsonValue ?? {};
  const productIds = new Set(
    Array.isArray(configuration.productIds) ? configuration.productIds : [],
  );

  // Collection membership comes from inAnyCollection, which Shopify resolves
  // against the collectionIds input variable read from the same metafield.
  const cartHasCampaignProduct = input.cart.lines.some((line) => {
    if (line.merchandise.__typename !== "ProductVariant") {
      return false;
    }

    const { product } = line.merchandise;
    return productIds.has(product.id) || product.inAnyCollection === true;
  });

  if (!cartHasCampaignProduct) {
    return NO_CHANGES;
  }

  const targets = input.cart.deliveryGroups.flatMap((group) =>
    group.deliveryOptions.map((option) => ({ deliveryOption: { handle: option.handle } })),
  );

  if (targets.length === 0) {
    return NO_CHANGES;
  }

  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates: [
            {
              message: FREE_SHIPPING_MESSAGE,
              targets,
              value: { percentage: { value: 100 } },
            },
          ],
          selectionStrategy: "ALL",
        },
      },
    ],
  };
}
```

- [ ] **Step 6: Kjør testene og se at de passerer**

Run: `npm test --workspace discounto-free-shipping`
Expected: PASS (6 tester).

- [ ] **Step 7: La root-`npm test` kjøre begge testsettene**

I root `package.json`, bytt

```json
    "test": "vitest run",
```

med

```json
    "test": "vitest run && npm test --workspace discounto-free-shipping",
```

Run: `npm test`
Expected: PASS for både app-testene og Function-testene.

- [ ] **Step 8: Deklarer metafelt-definisjonen**

I `shopify.app.toml`, etter `[app_proxy]`-blokken:

```toml
[discount.metafields.app.function-configuration]
type = "json"
name = "Discounto function configuration"
access.admin = "merchant_read"
access.storefront = "none"
```

- [ ] **Step 9: Hent schema, bygg og kjør Functionen lokalt**

`extensions/discounto-free-shipping/tests/fixtures/campaign-product-in-cart.json`:

```json
{
  "cart": {
    "lines": [
      {
        "merchandise": {
          "__typename": "ProductVariant",
          "product": { "id": "gid://shopify/Product/1", "inAnyCollection": false }
        }
      }
    ],
    "deliveryGroups": [
      { "deliveryOptions": [{ "handle": "standard" }] }
    ]
  },
  "discount": {
    "discountClasses": ["SHIPPING"],
    "metafield": {
      "jsonValue": { "productIds": ["gid://shopify/Product/1"], "collectionIds": [] }
    }
  }
}
```

Kjør fra `extensions/discounto-free-shipping` (CLI-en krever innlogging; ber den om det, kjør kommandoen selv med `!`-prefiks i Claude Code):

Run: `npx shopify app function schema`
Expected: `schema.graphql` skrives i extension-mappen.

Run: `npx shopify app function build`
Expected: bygger `dist/function.wasm` uten feil. Klager bygget på versjonen av `@shopify/shopify_function`, installer versjonen CLI-en oppgir (`npm install @shopify/shopify_function@<versjon> --workspace discounto-free-shipping`) og bygg på nytt.

Run: `npx shopify app function run --input tests/fixtures/campaign-product-in-cart.json --export cart-delivery-options-discounts-generate-run --json`
Expected: output inneholder `"deliveryDiscountsAdd"` med `"handle": "standard"` og `"value": 100`.

- [ ] **Step 10: Kjør sjekker og commit**

Run: `npm run lint` og `npx tsc --noEmit`
Expected: ingen feil.

```bash
git add extensions/discounto-free-shipping shopify.app.toml package.json package-lock.json .gitignore
git commit -m "Add a discount function that makes shipping free for campaign carts"
```

---

### Task 7: Storefront viser fraktbadge

**Files:**
- Modify: `app/routes/proxy.better-discounts.campaigns.tsx`
- Modify: `extensions/better-discounts-theme/blocks/storefront-sale-badges.liquid`
- Modify: `extensions/better-discounts-theme/assets/better-discounts.js`
- Modify: `extensions/better-discounts-theme/assets/better-discounts.css`

**Interfaces:**
- Consumes: `CampaignRecord.offerType`, `.freeShippingBadgeText`, `.badgeLayout` (Task 4).
- Produces:
  - Proxy-payload per kampanje: `offerType`, `freeShippingBadgeText: string | null`, `badgeLayout` (i tillegg til dagens felt; `discountKind`/`discountValue` kan være `null`).
  - `window.BetterDiscountsThemeConfig.freeShippingBadgePosition`.
  - I `better-discounts.js`: `campaignHasDiscount(campaign)`, `campaignHasFreeShipping(campaign)`, `resolveFreeShippingLabel(campaign)`, `resolveFreeShippingBadgePosition(config)`, `resolveCampaignBadges(campaign, discountLabel): Array<{ label: string; freeShipping: boolean }>`, `appendImageBadges(imageTarget, badges, config)`, `escapeHtml(value)`, og `createImageChip(labels: string[], position: string, config)` (ny signatur).

Oppførsel (fra spec):

| offerType | Pris | Bildebadge(r) | Sparelinje |
|---|---|---|---|
| DISCOUNT | overstyres | rabattbadge | som i dag |
| FREE_SHIPPING | uendret | fraktbadge; temaets egen salgsbadge skjules ikke | ingen |
| DISCOUNT_AND_FREE_SHIPPING + SEPARATE | overstyres | rabattbadge + fraktbadge i egen posisjon | som i dag |
| DISCOUNT_AND_FREE_SHIPPING + COMBINED | overstyres | én badge «{rabatt} · {frakt}» | som i dag |
| DISCOUNT_AND_FREE_SHIPPING + DISCOUNT_ONLY | overstyres | rabattbadge | som i dag |

Kampanjer uten `offerType` (gammel cache) behandles som `DISCOUNT`. Samme posisjon for begge badges gir én wrap med badgene under hverandre. Duplikatsjekken `!imageTarget.querySelector(".bd-chip-wrap")` beholdes: alle badges for et kort legges til i samme pass, så sjekken hindrer fortsatt doble badges.

Theme-scriptet er en IIFE uten modulsystem og har ingen enhetstester i dag. Denne tasken verifiseres med syntakssjekk og manuell test i dev-butikken.

- [ ] **Step 1: Send offer-feltene fra proxyen**

I `app/routes/proxy.better-discounts.campaigns.tsx`, i `payload.push({ ... })`, etter `badgeText: campaign.badgeText,`:

```ts
        offerType: campaign.offerType,
        freeShippingBadgeText: campaign.freeShippingBadgeText,
        badgeLayout: campaign.badgeLayout,
```

- [ ] **Step 2: Legg til posisjonsinnstillingen i app-embeden**

I `extensions/better-discounts-theme/blocks/storefront-sale-badges.liquid`, i `window.BetterDiscountsThemeConfig`, etter `badgePosition: ...,`:

```liquid
    freeShippingBadgePosition: {{ block.settings.free_shipping_badge_position | json }},
```

I `settings`, rett etter `badge_position`-selecten (`"label": "Image position"`):

```json
    {
      "type": "select",
      "id": "free_shipping_badge_position",
      "label": "Free shipping badge position",
      "default": "bottom-right",
      "options": [
        { "value": "top-left", "label": "Top left" },
        { "value": "top-right", "label": "Top right" },
        { "value": "bottom-left", "label": "Bottom left" },
        { "value": "bottom-right", "label": "Bottom right" }
      ],
      "info": "Used when a campaign shows free shipping as its own badge."
    },
```

- [ ] **Step 3: Legg til badge-hjelpere i `better-discounts.js`**

Etter `const BADGE_POSITIONS = [...]`:

```js
  const DEFAULT_FREE_SHIPPING_BADGE_TEXT = "Free shipping";
```

Bytt hele `createImageChip`:

```js
  function createImageChip(labels, position, config) {
    const wrap = document.createElement("div");
    wrap.className = `bd-chip-wrap bd-chip-wrap--${position}`;
    applyCustomProperties(wrap, config);

    labels.forEach((label) => {
      const chip = document.createElement("span");
      chip.className = `bd-chip bd-chip--image bd-style-${config.cardStyle}`;
      chip.textContent = label;
      applyCustomProperties(chip, config);
      wrap.appendChild(chip);
    });

    return wrap;
  }
```

Rett etter `resolveBadgePosition`:

```js
  // Campaigns cached before offers existed carry no offerType and are discounts.
  function campaignHasDiscount(campaign) {
    return campaign?.offerType !== "FREE_SHIPPING";
  }

  function campaignHasFreeShipping(campaign) {
    return (
      campaign?.offerType === "FREE_SHIPPING" ||
      campaign?.offerType === "DISCOUNT_AND_FREE_SHIPPING"
    );
  }

  function resolveFreeShippingLabel(campaign) {
    return (
      String(campaign?.freeShippingBadgeText || "").trim() || DEFAULT_FREE_SHIPPING_BADGE_TEXT
    );
  }

  function resolveFreeShippingBadgePosition(config) {
    const position = String(config?.freeShippingBadgePosition || "").trim();
    return BADGE_POSITIONS.includes(position) ? position : "bottom-right";
  }

  function resolveCampaignBadges(campaign, discountLabel) {
    if (!campaignHasFreeShipping(campaign)) {
      return [{ label: discountLabel, freeShipping: false }];
    }

    const shippingLabel = resolveFreeShippingLabel(campaign);

    if (!campaignHasDiscount(campaign)) {
      return [{ label: shippingLabel, freeShipping: true }];
    }

    if (campaign.badgeLayout === "COMBINED") {
      return [{ label: `${discountLabel} · ${shippingLabel}`, freeShipping: false }];
    }

    if (campaign.badgeLayout === "DISCOUNT_ONLY") {
      return [{ label: discountLabel, freeShipping: false }];
    }

    return [
      { label: discountLabel, freeShipping: false },
      { label: shippingLabel, freeShipping: true },
    ];
  }

  // Badges that share a corner go into one wrap so they stack instead of overlapping.
  function appendImageBadges(imageTarget, badges, config) {
    const labelsByPosition = new Map();

    badges.forEach((badge) => {
      const position = badge.freeShipping
        ? resolveFreeShippingBadgePosition(config)
        : resolveBadgePosition(config);

      if (!labelsByPosition.has(position)) {
        labelsByPosition.set(position, []);
      }

      labelsByPosition.get(position).push(badge.label);
    });

    labelsByPosition.forEach((labels, position) => {
      imageTarget.appendChild(createImageChip(labels, position, config));
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
```

- [ ] **Step 4: Bruk hjelperne på produktkort**

I `applyCampaignToCard`, rett etter `const campaign = findCampaignForCard(card, campaignLookup);`:

```js
    if (campaign && !campaignHasDiscount(campaign)) {
      if (priceHost) {
        restorePriceHost(priceHost);
      }

      if (imageTarget && config.showImageBadge && !imageTarget.querySelector(".bd-chip-wrap")) {
        imageTarget.classList.add("bd-sale-target");
        appendImageBadges(imageTarget, resolveCampaignBadges(campaign, ""), config);
      }

      card.dataset.bdProcessed = "true";
      return;
    }
```

I kampanje-grenen, bytt

```js
          imageTarget.appendChild(createImageChip(label, config));
```

med

```js
          appendImageBadges(imageTarget, resolveCampaignBadges(campaign, label), config);
```

I compare-at-fallbacken, bytt

```js
      fallbackData.imageTarget.appendChild(createImageChip(label, config));
```

med

```js
      fallbackData.imageTarget.appendChild(
        createImageChip([label], resolveBadgePosition(config), config),
      );
```

- [ ] **Step 5: Bruk hjelperne i produktblokken**

I `applyCampaignToProductBlocks`, rett etter `if (!campaign) { ... return; }`:

```js
      if (!campaignHasDiscount(campaign)) {
        livePriceHosts.forEach((host) => restorePriceHost(host));
        // Keep the block's compare-at content and only add the free shipping pill.
        block.querySelector(".bd-badge__pill--free-shipping")?.remove();

        if (block.getAttribute("data-bd-show-badge") === "true") {
          block.insertAdjacentHTML(
            "afterbegin",
            `<span class="bd-badge__pill bd-badge__pill--free-shipping">${escapeHtml(
              resolveFreeShippingLabel(campaign),
            )}</span>`,
          );
        }

        return;
      }
```

Bytt

```js
      if (showBadge) {
        fragments.push(`<span class="bd-badge__pill">${label}</span>`);
      }
```

med

```js
      if (showBadge) {
        resolveCampaignBadges(campaign, label).forEach((badge) => {
          const modifier = badge.freeShipping ? " bd-badge__pill--free-shipping" : "";
          fragments.push(
            `<span class="bd-badge__pill${modifier}">${escapeHtml(badge.label)}</span>`,
          );
        });
      }
```

(Rabattetiketten escapes nå også. Vanlige etiketter som «Save 10%» rendres likt som før.)

- [ ] **Step 6: Stable badges i samme hjørne**

I `extensions/better-discounts-theme/assets/better-discounts.css`, i `.bd-chip-wrap { ... }`, legg til etter `display: flex;`:

```css
  flex-direction: column;
  gap: 0.35rem;
```

Legg til `align-items: flex-start;` i regelen `.bd-chip-wrap--top-left, .bd-chip-wrap--bottom-left { ... }` og `align-items: flex-end;` i regelen `.bd-chip-wrap--top-right, .bd-chip-wrap--bottom-right { ... }`.

- [ ] **Step 7: Syntakssjekk og sjekker**

Run: `node --check extensions/better-discounts-theme/assets/better-discounts.js`
Expected: ingen output (gyldig syntaks).

Run: `npx tsc --noEmit`, `npm run lint`, `npm test`
Expected: ingen feil / PASS.

- [ ] **Step 8: Manuell sjekk i dev-butikken**

Run: `npm run dev`, åpne theme editor → App embeds → «Storefront sale badges», og sjekk at «Free shipping badge position» finnes med «Bottom right».

Lag tre aktive kampanjer på hvert sitt produkt: «Discount», «Free shipping» og «Discount + free shipping» (Badge display = Two separate badges). Åpne en kolleksjonsside med Horizon-temaet.

Expected:
- Discount-produktet ser ut som før (én badge oppe til venstre, rabattert pris).
- Free shipping-produktet: bare «Free shipping»-badge nede til høyre, originalpris.
- Kombinert-produktet: «Save 10%» oppe til venstre, «Free shipping» nede til høyre, rabattert pris.
- Bytt kombinert-kampanjen til «One combined badge» og last siden på nytt: én badge «Save 10% · Free shipping».
- Sett fraktposisjonen i theme editor til «Top left»: badgene står under hverandre oppe til venstre.

- [ ] **Step 9: Commit**

```bash
git add app/routes/proxy.better-discounts.campaigns.tsx extensions/better-discounts-theme
git commit -m "Show free shipping badges on the storefront"
```

---

### Task 8: Ende-til-ende-test i dev-butikken

**Files:**
- Ingen kodeendringer, med mindre testen avdekker feil (rett dem i tasken som eier koden, og commit der).

**Interfaces:**
- Consumes: alt fra Task 1–7.
- Produces: bekreftelse på at spec-scenarioene fungerer i kassen, klart for PR.

Kassen og Shopify admin kan bare testes av noen med tilgang til dev-butikken. Stegene under krever at brukeren er med.

- [ ] **Step 1: Start appen med den nye Functionen**

Run: `npm run dev`
Expected: Prisma-migreringen kjøres (`prisma migrate deploy`), og CLI-en viser `discounto-free-shipping` blant extensions uten byggefeil.

- [ ] **Step 2: Kun fri frakt**

Lag kampanjen «Test fri frakt» med Offer «Free shipping», badge-tekst «Fri frakt», ett produkt (A).

Expected:
- Kampanjen står som `ACTIVE` / `SYNCED`.
- Shopify admin → Discounts har én automatisk rabatt «Test fri frakt» av typen app-rabatt (frakt).
- Kurv med produkt A → kassen viser frakt 0 og meldingen «Free shipping».
- Kurv med bare et annet produkt → vanlig fraktpris.

- [ ] **Step 3: Rabatt + fri frakt**

Rediger kampanjen til «Discount + free shipping», 10 %.

Expected:
- Shopify admin har nå to rabatter med samme tittel: basic-rabatten og fraktrabatten.
- Kurv med produkt A → 10 % av produktet **og** frakt 0 i samme kasse.

- [ ] **Step 4: Kolleksjonskampanje**

Lag en kampanje med Offer «Free shipping» på en kolleksjon (krever Plus/Business). Legg et produkt fra kolleksjonen i kurven.

Expected: frakt 0. Legg deretter et nytt produkt til den valgte kolleksjonen (etter at kampanjen ble lagret) og sjekk at også det gir fri frakt, uten å lagre kampanjen på nytt.

- [ ] **Step 5: Endre, deaktivere og slette**

- Endre kampanjen fra Step 3 tilbake til «Discount» → fraktrabatten forsvinner fra Shopify admin, basic-rabatten står igjen, kassen har vanlig frakt.
- Endre den til «Free shipping» → basic-rabatten forsvinner, fraktrabatten opprettes.
- Deactivate → begge borte fra Shopify admin; kampanjen `ARCHIVED`.
- Activate → riktig rabatt opprettes igjen.
- Delete → ingen rabatter igjen i Shopify admin.

- [ ] **Step 6: Eksisterende kampanje er uendret**

Åpne en kampanje som fantes før endringen, uten å endre noe, og trykk «Save changes».

Expected: Offer vises som «Discount», synken lykkes, og basic-rabatten i Shopify admin kan fortsatt **ikke** kombineres med fraktrabatter.

- [ ] **Step 7: Storefront**

Gå gjennom alle radene i tabellen i Task 7 på både kolleksjonsside (kort) og produktside (blokken «Product sale badge»).

Expected: som i tabellen. På produktsiden for en kampanje med kun fri frakt beholdes eventuell compare-at-badge, og «Fri frakt»-pillen legges foran.

- [ ] **Step 8: Siste sjekk før PR**

Run: `npm test`, `npx tsc --noEmit`, `npm run lint`
Expected: PASS / ingen feil.

Produksjon krever `npm run deploy` (`shopify app deploy`) for å publisere Functionen og metafelt-definisjonen. Det er en utadrettet handling: spør brukeren før den kjøres. Databasemigreringen kjøres automatisk når Docker-containeren starter (`npm run setup`).
