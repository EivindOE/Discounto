import type { LoaderFunctionArgs } from "@remix-run/node";
import { listVisibleStorefrontCampaignsForShop } from "../models/discount.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return Response.json(
      {
        campaigns: [],
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const campaigns = await listVisibleStorefrontCampaignsForShop(session.shop);

  return Response.json(
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
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
