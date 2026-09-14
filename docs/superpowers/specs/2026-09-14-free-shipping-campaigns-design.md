# Fri frakt i kampanjer – design

Dato: 2026-09-14
Status: Godkjent design, klar for implementasjonsplan

## Bakgrunn

En butikk ønsker å vise «Fri frakt» som badge på samme måte som «Spar 10%», og å kunne gi fri frakt gjennom en kampanje – enten alene eller kombinert med prisrabatt.

I dag støtter Discounto bare prisrabatter (`PERCENTAGE` / `FIXED_AMOUNT`) via Shopify sin automatiske basic-rabatt, med `combinesWith.shippingDiscounts: false`. Storefront viser maks én badge per produktkort.

## Mål

- En kampanje kan gi **kun rabatt**, **kun fri frakt**, eller **rabatt + fri frakt**.
- Fri frakt gjelder **frakten på hele bestillingen** når handlekurven inneholder **minst ett produkt fra kampanjen** (valgt direkte eller via kolleksjon).
- Butikken velger per kampanje hvordan badgene vises når kampanjen har begge: to separate badges, én samlet badge, eller kun rabattbadge.

## Ikke-mål

- Minstebeløp for fri frakt (kan legges til senere).
- Begrensning på destinasjon, maks fraktpris eller kundesegment.
- Rabattkoder – kun automatiske rabatter, som i dag.
- Å flytte eksisterende prisrabatt over til Functions.

## Hvorfor en Shopify Function

`DiscountAutomaticFreeShippingInput` (Admin API 2026-07) har ingen felt for å begrense fri frakt til bestemte produkter eller kolleksjoner – bare `minimumRequirement`, `destination`, `maximumShippingPrice`, `context` m.m. Kravet «fri frakt hvis kurven inneholder et kampanjeprodukt» krever derfor en Discount Function med målet `cart.delivery-options.discounts.generate.run`.

Valgt tilnærming (A): behold dagens basic-rabatt for prisdelen uendret, og legg til en egen app-rabatt (Function) for fraktdelen. Forkastet (B): én Function for både pris og frakt – krever omskriving og migrering av fungerende kode uten gevinst for butikken.

## 1. Datamodell

Én Prisma-migrering på `DiscountCampaign`:

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

model DiscountCampaign {
  // eksisterende felt ...
  offerType                 CampaignOffer       @default(DISCOUNT)
  discountKind              DiscountKind?       // null når offerType = FREE_SHIPPING
  discountValue             Float?              // null når offerType = FREE_SHIPPING
  freeShippingBadgeText     String?
  badgeLayout               CampaignBadgeLayout @default(SEPARATE)
  shopifyShippingDiscountId String?
}
```

Regler:

- Eksisterende rader får `offerType = DISCOUNT` og beholder `discountKind`/`discountValue` – ingen atferdsendring.
- `offerType` inneholder rabatt ⇒ `discountKind` og `discountValue > 0` er påkrevd (valideres i rutene som i dag).
- `offerType = FREE_SHIPPING` ⇒ `discountKind`/`discountValue` lagres som `null`.
- `badgeLayout` brukes kun når `offerType = DISCOUNT_AND_FREE_SHIPPING`.
- `freeShippingBadgeText` tom ⇒ storefront bruker standardteksten «Free shipping».
- `shopifyDiscountId` beholder betydningen «prisrabatten i Shopify»; `shopifyShippingDiscountId` er fraktrabatten.

## 2. Shopify Function: `extensions/discounto-free-shipping`

- Type `function`, JavaScript, `api_version = "2026-07"`, handle `discounto-free-shipping`.
- Ett mål: `cart.delivery-options.discounts.generate.run`.
- `[extensions.input.variables] namespace = "$app"`, `key = "function-configuration"`.

Konfigurasjon (JSON-metafelt på app-rabatten, namespace `$app`, key `function-configuration`):

```json
{ "productIds": ["gid://shopify/Product/1"], "collectionIds": ["gid://shopify/Collection/2"] }
```

Input query:

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
    metafield(namespace: "$app", key: "function-configuration") {
      jsonValue
    }
  }
}
```

Logikk:

1. Les `productIds` fra metafeltet (tom liste hvis mangler).
2. En linje kvalifiserer hvis `product.id ∈ productIds` eller `product.inAnyCollection === true`.
3. Ingen kvalifiserende linjer, eller ingen fraktvalg ⇒ `{ operations: [] }`.
4. Ellers én `deliveryDiscountsAdd` med `selectionStrategy: ALL`, én kandidat med `value: { percentage: { value: 100 } }` som målretter alle `deliveryOption.handle`, og `message` = «Free shipping».

Kolleksjoner sjekkes live i kassen via `inAnyCollection`, så produkter som legges til en kolleksjon senere kvalifiserer uten ny synk. Produkt-kampanjer bruker `productIds`.

## 3. Synk mot Shopify

I `app/models/shopify-discounts.server.ts`:

- Nye funksjoner `createShippingDiscountInShopify`, `updateShippingDiscountInShopify` som bruker `discountAutomaticAppCreate` / `discountAutomaticAppUpdate` med:
  - `functionHandle: "discounto-free-shipping"`
  - `discountClasses: [SHIPPING]`
  - `combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: false }`
  - `metafields: [{ namespace: "$app", key: "function-configuration", type: "json", value }]`
  - `title`, `startsAt`, `endsAt` som prisrabatten.
- Sletting bruker eksisterende `deleteAutomaticDiscountInShopify` (`discountAutomaticDelete` gjelder også app-rabatter).
- Basic-rabattens `combinesWith.shippingDiscounts` settes til `true` **kun** når kampanjen har fri frakt; ellers `false` som i dag.

En felles orkestrering (f.eks. `syncCampaignDiscountsInShopify`) brukes av alle stedene som synker i dag:

- `app/routes/app.discounts.new.tsx` (opprett)
- `app/routes/app.discounts.$campaignId.tsx` (rediger)
- `app/routes/app.discounts._index.tsx` (activate / deactivate / delete)

Oppførsel:

| Ønsket del | Finnes i Shopify | Handling |
|---|---|---|
| Prisrabatt | nei | opprett |
| Prisrabatt | ja | oppdater |
| Ingen prisrabatt | ja | slett |
| Fri frakt | nei | opprett |
| Fri frakt | ja | oppdater |
| Ingen fri frakt | ja | slett |

Feilhåndtering: rabatter som ble **opprettet** i samme operasjon slettes igjen hvis et senere steg feiler, før kampanjen merkes `SYNC_FAILED` med feilmeldingen (som i dag). Deactivate/delete sletter begge ID-ene. Shopify sin grense på 25 aktive automatiske app-rabatter per butikk kommer som `userError` og vises i banneret.

`markCampaignSyncSuccess`, `markCampaignActive` og `markCampaignArchived` utvides med `shopifyShippingDiscountId`.

## 4. Kampanje-editoren (`app/components/CampaignEditor.tsx`)

- Nytt felt **Offer**: «Discount» / «Free shipping» / «Discount + free shipping».
- «Discount type» og verdi skjules når Offer = «Free shipping».
- **Free shipping badge text** (vises når Offer inneholder fri frakt), standard «Free shipping».
- **Badge display** (vises kun ved «Discount + free shipping»): «Two separate badges» / «One combined badge» / «Discount badge only».
- Eksisterende «Badge text» gjelder rabattbadgen og skjules når Offer = «Free shipping».
- Kampanjelisten (`app.discounts._index.tsx`) viser offer-typen.

## 5. Storefront

Proxy (`app/routes/proxy.better-discounts.campaigns.tsx`) sender i tillegg `offerType`, `freeShippingBadgeText` og `badgeLayout`.

App-embed (`blocks/storefront-sale-badges.liquid`): ny innstilling **Free shipping badge position** (top-left/top-right/bottom-left/bottom-right, standard `bottom-right`), sendt som `freeShippingBadgePosition` i `BetterDiscountsThemeConfig`.

Produktkort (`applyCampaignToCard` i `better-discounts.js`):

| offerType | Pris | Bildebadge(r) | Sparelinje |
|---|---|---|---|
| DISCOUNT | overstyres | rabattbadge (som i dag) | som i dag |
| FREE_SHIPPING | uendret | fraktbadge | ingen |
| DISCOUNT_AND_FREE_SHIPPING + SEPARATE | overstyres | rabattbadge + fraktbadge i egen posisjon | som i dag |
| DISCOUNT_AND_FREE_SHIPPING + COMBINED | overstyres | én badge «{rabatt} · {frakt}» | som i dag |
| DISCOUNT_AND_FREE_SHIPPING + DISCOUNT_ONLY | overstyres | rabattbadge | som i dag |

- Duplikatsjekken `!imageTarget.querySelector(".bd-chip-wrap")` erstattes av en sjekk per badge (data-attributt på wrap), så kort ikke får doble badges ved re-render.
- Samme posisjon for begge badges ⇒ de legges under hverandre i samme hjørne (flex-kolonne i wrap).
- Temaets «Custom badge text» gjelder kun rabattbadgen.
- Kampanjer med kun fri frakt påvirker ikke compare-at-fallback for produkter uten kampanje.

Produktside (`applyCampaignToProductBlocks`): samme regler for pill(er) i blokken. Ved `FREE_SHIPPING` vises kun frakt-pill; pris og sparelinje endres ikke.

## 6. Testing og utrulling

- Function: vitest-tester for logikken – kampanjeprodukt i kurv, produkt via kolleksjon, ingen treff, tom/manglende konfigurasjon, ingen fraktvalg.
- App: `npm run lint` og typesjekk (`tsc --noEmit`). Repoet har ikke testrammeverk for appen.
- Manuell test i dev-butikk:
  1. Kun fri frakt: kurv med kampanjeprodukt ⇒ frakt 0; uten ⇒ vanlig frakt.
  2. Rabatt + fri frakt: begge gjelder samtidig i kassen.
  3. Kolleksjonskampanje: produkt i kolleksjon gir fri frakt.
  4. Endre offer på eksisterende kampanje, deaktiver og slett ⇒ riktige rabatter finnes/slettes i Shopify admin.
  5. Eksisterende kampanje uten endring oppfører seg som før.
  6. Storefront: alle rader i tabellen over, på kort og produktside.
- Utrulling: `prisma migrate deploy` (skjer ved start), `shopify app deploy` for å publisere Functionen. Scopes er uendret.
