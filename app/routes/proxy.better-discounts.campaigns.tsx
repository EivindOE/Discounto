import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  createCollectionResolutionCache,
  resolveCampaignTargetProducts,
} from "../models/campaign-targets.server";
import { listVisibleStorefrontCampaignsForShop } from "../models/discount.server";
import { unauthenticated } from "../shopify.server";

function getShopFromRequest(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim().toLowerCase() ?? "";

  if (!shop.endsWith(".myshopify.com")) {
    return null;
  }

  return shop;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = {
    "Cache-Control": "no-store",
  };

  const shop = getShopFromRequest(request);

  if (!shop) {
    return json({ campaigns: [] }, { headers });
  }

  try {
    const campaigns = await listVisibleStorefrontCampaignsForShop(shop);
    const { admin } = await unauthenticated.admin(shop);
    // Shared across every campaign so a collection used by several campaigns is
    // fetched from Shopify once per storefront request.
    const collectionCache = createCollectionResolutionCache();
    const payload = [];

    for (const campaign of campaigns) {
      let products: Array<{ productGid: string; productHandle?: string | null }>;

      try {
        products = await resolveCampaignTargetProducts({
          admin,
          selectedProducts: campaign.products,
          selectedCollections: campaign.collections,
          cache: collectionCache,
        });
      } catch (error) {
        // Keep the other campaigns' badges alive instead of blanking the store.
        console.error("Discounto storefront proxy could not resolve campaign targets", {
          error,
          campaignId: campaign.id,
        });
        products = campaign.products;
      }

      payload.push({
        id: campaign.id,
        title: campaign.title,
        badgeText: campaign.badgeText,
        discountKind: campaign.discountKind,
        discountValue: campaign.discountValue,
        startsAt: campaign.startsAt?.toISOString() ?? null,
        endsAt: campaign.endsAt?.toISOString() ?? null,
        collections: campaign.collections.map((collection) => ({
          collectionGid: collection.collectionGid,
          collectionHandle: collection.collectionHandle,
        })),
        products: products.map((product) => ({
          productGid: product.productGid,
          productHandle: product.productHandle ?? null,
        })),
      });
    }

    return json({ campaigns: payload }, { headers });
  } catch (error) {
    console.error("Discounto storefront proxy failed", error);
    return json({ campaigns: [] }, { headers });
  }
};
