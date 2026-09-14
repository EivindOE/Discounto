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
  const message =
    typeof configuration.message === "string" && configuration.message.trim()
      ? configuration.message
      : FREE_SHIPPING_MESSAGE;

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
              message,
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
