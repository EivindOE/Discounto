import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { resolveCampaignTargetProducts } from "../models/campaign-targets.server";
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

    return json(
      {
        campaigns: await Promise.all(
          campaigns.map(async (campaign) => ({
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
            products: (
              await resolveCampaignTargetProducts({
                admin,
                selectedProducts: campaign.products,
                selectedCollections: campaign.collections,
              })
            ).map((product) => ({
              productGid: product.productGid,
              productHandle: product.productHandle,
            })),
          })),
        ),
      },
      { headers },
    );
  } catch (error) {
    console.error("Discounto storefront proxy failed", error);
    return json({ campaigns: [] }, { headers });
  }
};
