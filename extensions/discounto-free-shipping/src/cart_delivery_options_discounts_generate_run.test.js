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
