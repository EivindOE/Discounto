# Discounto

Shopify-app for butikker som vil at rabatter skal synes i butikkfronten uten at kunden må redigere theme-filer manuelt.

## Produktidé

Butikkeieren skal i praksis kunne:

1. Installere appen.
2. Opprette en rabatt i appen.
3. Se rabatten vist automatisk på produktsider og produktkort.

Første prismodell i dette repoet:

- `Free`: opptil 10 produkter med rabattvisning.
- `Plus`: opptil 50 produkter med rabattvisning.
- `Business`: ubegrenset.

Prisene i kodebasen er foreløpige forslag:

- `Free`: `$0`
- `Plus`: `$19 / month`
- `Business`: `$79 / month`

## Teknisk retning

Dette prosjektet bruker den offisielle Shopify Remix-malen som base, og er tilpasset rundt følgende flyt:

- Embedded admin-app i Shopify for rabattoppsett.
- Lokal datamodell for kampanjer, produkter og abonnement.
- Shopify Billing for å styre planer.
- Theme app extension for å vise badge/tekst i butikkfronten.
- Senere kobling til Shopify Discounts API / Functions for faktisk rabattlogikk.

## Hva som er satt opp nå

- Dashboard for Discounto i embedded admin.
- Egen rabattliste og side for å opprette rabatt.
- Prisma-modeller for `ShopSettings`, `DiscountCampaign` og `DiscountProduct`.
- Planmodell for `Free`, `Plus` og `Business`.
- Oppdaterte Shopify-scopes som passer bedre til produktet.

## Kom i gang

### 1. Installer avhengigheter

```bash
npm install
```

### 2. Opprett databasen lokalt

Generer Prisma-klienten:

```bash
npx prisma generate
```

Bootstrap SQLite-databasen:

```bash
npx prisma db execute --file prisma/bootstrap.sql --schema prisma/schema.prisma
```

### 3. Koble prosjektet til en Shopify-app

Dette krever interaktiv innlogging i Shopify CLI:

```bash
shopify app config link
```

Deretter fyller du inn miljøvariabler og kjører:

```bash
shopify app dev
```

## Neste steg

- Koble `Opprett rabatt` til Shopify Admin GraphQL for å opprette ekte rabatter.
- Legge til theme app extension som leser appdata og viser badge på frontend.
- Lage billing-flyt med `AppSubscription`.
- Synke valgte produkter fra Shopify-produktvelger i stedet for tekstfelt med GID-er.

## Dokumentasjon

- [Produktplan](./docs/product-plan.md)
- [Arkitektur](./docs/shopify-architecture.md)
