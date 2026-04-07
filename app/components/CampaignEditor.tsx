import { useEffect, useMemo, useState } from "react";
import { Form, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  InlineStack,
  List,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { InternalRouteButton } from "./InternalRouteButton";
import type { SelectedProductInput } from "../models/discount.server";

type PickerProduct = {
  id?: string;
  title?: string;
  handle?: string;
  images?: Array<{ originalSrc?: string; url?: string; src?: string }>;
};

type CampaignEditorProps = {
  titleBar: string;
  pageTitle: string;
  submitLabel: string;
  plan: string;
  productLimit: number;
  initialValues?: {
    title?: string;
    discountKind?: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue?: string;
    badgeText?: string;
    selectedProducts?: SelectedProductInput[];
    startsAtLocal?: string;
    endsAtLocal?: string;
  };
  actionData?: {
    error?: string;
  };
};

function buildDefaultBadgeText(kind: string, value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  return kind === "FIXED_AMOUNT" ? `Save $${trimmedValue}` : `Save ${trimmedValue}%`;
}

function toLocalDateTimeInputValue(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function toUtcIsoString(value: string) {
  if (!value) return "";

  const localDate = new Date(value);
  if (Number.isNaN(localDate.getTime())) return "";

  return localDate.toISOString();
}

export function CampaignEditor({
  titleBar,
  pageTitle,
  submitLabel,
  plan,
  productLimit,
  initialValues,
  actionData,
}: CampaignEditorProps) {
  const navigation = useNavigation();
  const shopify = useAppBridge() as unknown as {
    resourcePicker?: (options: Record<string, unknown>) => Promise<unknown>;
    toast?: {
      show: (message: string, options?: { isError?: boolean }) => void;
    };
  };
  const isSubmitting = navigation.state === "submitting";
  const isBusinessPlan = productLimit > 100000;

  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [discountKind, setDiscountKind] = useState(
    initialValues?.discountKind ?? "PERCENTAGE",
  );
  const [discountValue, setDiscountValue] = useState(initialValues?.discountValue ?? "15");
  const [badgeText, setBadgeText] = useState(
    initialValues?.badgeText ??
      buildDefaultBadgeText(
        initialValues?.discountKind ?? "PERCENTAGE",
        initialValues?.discountValue ?? "15",
      ),
  );
  const [badgeTextTouched, setBadgeTextTouched] = useState(Boolean(initialValues?.badgeText));
  const [selectedProducts, setSelectedProducts] = useState<SelectedProductInput[]>(
    initialValues?.selectedProducts ?? [],
  );
  const [startsAtLocal, setStartsAtLocal] = useState(initialValues?.startsAtLocal ?? "");
  const [endsAtLocal, setEndsAtLocal] = useState(initialValues?.endsAtLocal ?? "");
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    if (badgeTextTouched) {
      return;
    }

    setBadgeText(buildDefaultBadgeText(discountKind, discountValue));
  }, [badgeTextTouched, discountKind, discountValue]);

  const helperText = useMemo(() => {
    if (isBusinessPlan) {
      return `You are currently on ${plan}. This plan does not limit the number of products you can include in one campaign.`;
    }

    return `You are currently on ${plan}. This plan supports up to ${productLimit} products in a single campaign.`;
  }, [isBusinessPlan, plan, productLimit]);

  const handleOpenProductPicker = async () => {
    setPickerError(null);

    try {
      if (!shopify.resourcePicker) {
        const message =
          "The Shopify product picker is not available right now. Reload the app and try again.";

        setPickerError(message);
        shopify.toast?.show(message, { isError: true });
        return;
      }

      const result = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: isBusinessPlan ? true : productLimit,
        filter: {
          variants: false,
          draft: false,
          archived: false,
        },
        selectionIds: selectedProducts.map((product) => ({ id: product.productGid })),
      });

      if (!Array.isArray(result)) {
        return;
      }

      const normalizedProducts: SelectedProductInput[] = [];

      for (const item of result) {
        const product = item as PickerProduct;

        if (!product.id) {
          continue;
        }

        normalizedProducts.push({
          productGid: product.id,
          productTitle: product.title ?? null,
          productHandle: product.handle ?? null,
          imageUrl:
            product.images?.[0]?.originalSrc ??
            product.images?.[0]?.url ??
            product.images?.[0]?.src ??
            null,
        });
      }

      if (!isBusinessPlan && normalizedProducts.length > productLimit) {
        const limitedProducts = normalizedProducts.slice(0, productLimit);
        const message = `Your ${plan} plan supports ${productLimit} products per campaign. Only the first ${productLimit} products were kept.`;

        setSelectedProducts(limitedProducts);
        setPickerError(message);
        shopify.toast?.show(message, { isError: true });
        return;
      }

      setSelectedProducts(normalizedProducts);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The product picker could not be opened.";

      setPickerError(message);
      shopify.toast?.show(message, { isError: true });
    }
  };

  return (
    <Page backAction={{ content: "Discounts", url: "/app/discounts" }} title={pageTitle}>
      <TitleBar title={titleBar} />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Build a native Shopify automatic discount, keep campaign metadata in
              Discounto, and power storefront badges from your app data.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {helperText}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <Form method="post">
            <input
              type="hidden"
              name="selectedProducts"
              value={JSON.stringify(selectedProducts)}
            />
            <input type="hidden" name="startsAtUtc" value={toUtcIsoString(startsAtLocal)} />
            <input type="hidden" name="endsAtUtc" value={toUtcIsoString(endsAtLocal)} />
            <FormLayout>
              {actionData?.error ? <Banner tone="critical">{actionData.error}</Banner> : null}
              {pickerError ? <Banner tone="warning">{pickerError}</Banner> : null}

              <TextField
                label="Campaign name"
                name="title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
                helpText="This title is used for the Shopify automatic discount and inside Discounto."
              />

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

              <InlineStack gap="300" align="start">
                <div style={{ minWidth: 280 }}>
                  <TextField
                    label="Start date and time"
                    type="datetime-local"
                    value={startsAtLocal}
                    onChange={setStartsAtLocal}
                    autoComplete="off"
                    helpText="Leave blank to start the campaign immediately."
                  />
                </div>
                <div style={{ minWidth: 280 }}>
                  <TextField
                    label="End date and time"
                    type="datetime-local"
                    value={endsAtLocal}
                    onChange={setEndsAtLocal}
                    autoComplete="off"
                    helpText="Leave blank to keep the campaign running until you deactivate it."
                  />
                </div>
              </InlineStack>

              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Selected products
                  </Text>
                  <Button onClick={handleOpenProductPicker}>
                    {selectedProducts.length > 0 ? "Edit products" : "Select products"}
                  </Button>
                </InlineStack>

                {selectedProducts.length > 0 ? (
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        {selectedProducts.length} product
                        {selectedProducts.length === 1 ? "" : "s"} selected
                      </Text>
                      <List>
                        {selectedProducts.map((product) => (
                          <List.Item key={product.productGid}>
                            {product.productTitle ?? product.productGid}
                            {product.productHandle ? ` (${product.productHandle})` : ""}
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  </Card>
                ) : (
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No products selected yet. Use Shopify&apos;s product picker to
                      choose the products for this campaign.
                    </Text>
                  </Box>
                )}
              </BlockStack>

              <InlineStack gap="300">
                <Button submit variant="primary" loading={isSubmitting}>
                  {submitLabel}
                </Button>
                <InternalRouteButton to="/app/discounts" dataTestId="discounts-cancel">
                  Cancel
                </InternalRouteButton>
              </InlineStack>
            </FormLayout>
          </Form>
        </Card>
      </BlockStack>
    </Page>
  );
}

export { toLocalDateTimeInputValue };
