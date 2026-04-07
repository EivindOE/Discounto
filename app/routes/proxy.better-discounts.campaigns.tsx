import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { listVisibleStorefrontCampaignsForShop } from "../models/discount.server";

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

    return json(
      {
        campaigns: campaigns.map((campaign) => ({
          id: campaign.id,
          title: campaign.title,
          badgeText: campaign.badgeText,
          discountKind: campaign.discountKind,
          discountValue: campaign.discountValue,
          startsAt: campaign.startsAt?.toISOString() ?? null,
          endsAt: campaign.endsAt?.toISOString() ?? null,
          products: campaign.products.map((product) => ({
            productGid: product.productGid,
            productHandle: product.productHandle,
          })),
        })),
      },
      { headers },
    );
  } catch (error) {
    console.error("Discounto storefront proxy failed", error);
    return json({ campaigns: [] }, { headers });
  }
};
