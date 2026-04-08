import { useEffect, useMemo, useState } from "react";
import { Form, useFetcher, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
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
import type {
  SelectedCollectionInput,
  SelectedProductInput,
} from "../models/discount.server";
import type { PlanDefinition, PlanTier } from "../lib/plans";

type PickerProduct = {
  id?: string;
  title?: string;
  handle?: string;
  images?: Array<{ originalSrc?: string; url?: string; src?: string }>;
};

type PickerCollection = {
  id?: string;
  title?: string;
  handle?: string;
  image?: { originalSrc?: string; url?: string; src?: string };
};

type CampaignEditorProps = {
  titleBar: string;
  pageTitle: string;
  submitLabel: string;
  plan: PlanTier;
  planConfig: PlanDefinition;
  usage: {
    activeCampaignCount: number;
    activeProductCount: number;
  };
  initialValues?: {
    id?: string;
    title?: string;
    discountKind?: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue?: string;
    badgeText?: string;
    selectedProducts?: SelectedProductInput[];
    selectedCollections?: SelectedCollectionInput[];
    currentCoverageCount?: number;
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

function splitLocalDateTimeParts(value?: string | null) {
  const localValue = toLocalDateTimeInputValue(value);

  if (!localValue) {
    return {
      date: "",
      time: "",
    };
  }

  const [date, time] = localValue.split("T");

  return {
    date: date ?? "",
    time: time ?? "",
  };
}

function buildLocalDateTimeValue(date: string, time: string) {
  if (!date) {
    return "";
  }

  return `${date}T${time || "00:00"}`;
}

function toUtcIsoString(date: string, time: string) {
  if (!date) return "";

  const localDate = new Date(buildLocalDateTimeValue(date, time));
  if (Number.isNaN(localDate.getTime())) return "";

  return localDate.toISOString();
}

function addDaysToLocalParts(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  const localValue = offsetDate.toISOString().slice(0, 16);
  const [isoDate, isoTime] = localValue.split("T");

  return {
    date: isoDate ?? "",
    time: isoTime ?? "09:00",
  };
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

export function CampaignEditor({
  titleBar,
  pageTitle,
  submitLabel,
  plan,
  planConfig,
  usage,
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
  const coverageFetcher = useFetcher<{
    ok: boolean;
    canUseCollections: boolean;
    selectedProductCount: number;
    selectedCollectionCount: number;
    projectedCampaignCoverageCount: number;
    usage: {
      activeCampaignCount: number;
      activeProductCount: number;
    };
    coverageMessage?: string;
    collectionResolutionFailed: boolean;
  }>();
  const isUnlimitedPlan = planConfig.activeProductLimit == null;
  const canSchedule = planConfig.canSchedule;
  const canUseCollections = planConfig.canUseCollections;
  const currentCampaignProductCount = initialValues?.selectedProducts?.length ?? 0;
  const currentCampaignCoverageCount =
    initialValues?.currentCoverageCount ?? currentCampaignProductCount;
  const remainingProductSlots =
    planConfig.activeProductLimit == null
      ? null
      : Math.max(
          planConfig.activeProductLimit -
            Math.max(usage.activeProductCount - currentCampaignCoverageCount, 0),
          0,
        );

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
  const [selectedCollections, setSelectedCollections] = useState<SelectedCollectionInput[]>(
    initialValues?.selectedCollections ?? [],
  );
  const initialStart = splitLocalDateTimeParts(initialValues?.startsAtLocal ?? "");
  const initialEnd = splitLocalDateTimeParts(initialValues?.endsAtLocal ?? "");
  const [startsAtDate, setStartsAtDate] = useState(initialStart.date);
  const [startsAtTime, setStartsAtTime] = useState(initialStart.time || "09:00");
  const [endsAtDate, setEndsAtDate] = useState(initialEnd.date);
  const [endsAtTime, setEndsAtTime] = useState(initialEnd.time || "23:59");
  const [scheduleEnabled, setScheduleEnabled] = useState(
    Boolean(initialValues?.startsAtLocal || initialValues?.endsAtLocal),
  );
  const [customStartEnabled, setCustomStartEnabled] = useState(Boolean(initialValues?.startsAtLocal));
  const [customEndEnabled, setCustomEndEnabled] = useState(Boolean(initialValues?.endsAtLocal));
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    if (badgeTextTouched) {
      return;
    }

    setBadgeText(buildDefaultBadgeText(discountKind, discountValue));
  }, [badgeTextTouched, discountKind, discountValue]);

  useEffect(() => {
    const formData = new FormData();
    formData.set("selectedProducts", JSON.stringify(selectedProducts));
    formData.set("selectedCollections", JSON.stringify(selectedCollections));

    if (initialValues?.id) {
      formData.set("replaceCampaignId", initialValues.id);
    }

    coverageFetcher.submit(formData, {
      method: "post",
      action: "/app/campaign-coverage",
    });
  }, [coverageFetcher, selectedCollections, selectedProducts, initialValues?.id]);

  const helperText = useMemo(() => {
    if (isUnlimitedPlan) {
      return `${planConfig.name} includes unlimited active campaigns, unlimited active products, scheduling, and collection campaigns.`;
    }

    return `${planConfig.name} includes up to ${planConfig.activeCampaignLimit} active campaign${
      planConfig.activeCampaignLimit === 1 ? "" : "s"
    } and up to ${planConfig.activeProductLimit} unique active products across all live campaigns${canUseCollections ? ", including collection coverage." : "."}`;
  }, [canUseCollections, isUnlimitedPlan, planConfig]);

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
        multiple: true,
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

      if (
        planConfig.activeProductLimit != null &&
        normalizedProducts.length > planConfig.activeProductLimit
      ) {
        const limitedProducts = normalizedProducts.slice(0, planConfig.activeProductLimit);
        const message = `Your ${planConfig.name} plan supports up to ${planConfig.activeProductLimit} unique active products across live campaigns. Only the first ${planConfig.activeProductLimit} products were kept here.`;

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

  const handleOpenCollectionPicker = async () => {
    setPickerError(null);

    if (!canUseCollections) {
      const message =
        "Collection campaigns are available on Plus and Business. Upgrade in Billing to target collections.";

      setPickerError(message);
      shopify.toast?.show(message, { isError: true });
      return;
    }

    try {
      if (!shopify.resourcePicker) {
        const message =
          "The Shopify collection picker is not available right now. Reload the app and try again.";

        setPickerError(message);
        shopify.toast?.show(message, { isError: true });
        return;
      }

      const result = await shopify.resourcePicker({
        type: "collection",
        action: "select",
        multiple: true,
        selectionIds: selectedCollections.map((collection) => ({
          id: collection.collectionGid,
        })),
      });

      if (!Array.isArray(result)) {
        return;
      }

      const normalizedCollections: SelectedCollectionInput[] = [];

      for (const item of result) {
        const collection = item as PickerCollection;

        if (!collection.id) {
          continue;
        }

        normalizedCollections.push({
          collectionGid: collection.id,
          collectionTitle: collection.title ?? null,
          collectionHandle: collection.handle ?? null,
          imageUrl:
            collection.image?.originalSrc ?? collection.image?.url ?? collection.image?.src ?? null,
        });
      }

      setSelectedCollections(normalizedCollections);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The collection picker could not be opened.";

      setPickerError(message);
      shopify.toast?.show(message, { isError: true });
    }
  };

  const normalizedStartsAtDate = scheduleEnabled && customStartEnabled ? startsAtDate : "";
  const normalizedStartsAtTime = scheduleEnabled && customStartEnabled ? startsAtTime : "";
  const normalizedEndsAtDate = scheduleEnabled && customEndEnabled ? endsAtDate : "";
  const normalizedEndsAtTime = scheduleEnabled && customEndEnabled ? endsAtTime : "";
  const liveCoverageSummary = coverageFetcher.data;
  const selectedCoverageCount =
    liveCoverageSummary?.projectedCampaignCoverageCount ?? currentCampaignCoverageCount;
  const coverageMessage = liveCoverageSummary?.coverageMessage;
  const scheduleDateHelp = "Use YYYY-MM-DD. Discounto stores the selected local time as UTC.";

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
            <Text as="p" variant="bodySm" tone="subdued">
              {isUnlimitedPlan
                ? `${usage.activeCampaignCount} active campaigns and ${usage.activeProductCount} active products are currently live on this shop.`
                : `${usage.activeCampaignCount} of ${planConfig.activeCampaignLimit} active campaigns used. ${usage.activeProductCount} of ${planConfig.activeProductLimit} active products covered.`}
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
            <input
              type="hidden"
              name="selectedCollections"
              value={JSON.stringify(selectedCollections)}
            />
            <input
              type="hidden"
              name="startsAtUtc"
              value={toUtcIsoString(normalizedStartsAtDate, normalizedStartsAtTime)}
            />
            <input
              type="hidden"
              name="endsAtUtc"
              value={toUtcIsoString(normalizedEndsAtDate, normalizedEndsAtTime)}
            />
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

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Schedule
                </Text>

                {!canSchedule ? (
                  <Banner tone="info">
                    Scheduling is available on Plus and Business. Upgrade in Billing
                    if you want campaigns to start or end automatically.
                  </Banner>
                ) : (
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="300">
                      <Checkbox
                        label="Schedule this campaign"
                        checked={scheduleEnabled}
                        onChange={(checked) => {
                          setScheduleEnabled(checked);
                          if (!checked) {
                            setCustomStartEnabled(false);
                            setCustomEndEnabled(false);
                            setStartsAtDate("");
                            setStartsAtTime("09:00");
                            setEndsAtDate("");
                            setEndsAtTime("23:59");
                          }
                        }}
                      />

                      {scheduleEnabled ? (
                        <BlockStack gap="300">
                          <Checkbox
                            label="Choose a start date"
                            checked={customStartEnabled}
                            onChange={(checked) => {
                              setCustomStartEnabled(checked);
                              if (!checked) {
                                setStartsAtDate("");
                                setStartsAtTime("09:00");
                              }
                            }}
                            helpText={
                              customStartEnabled
                                ? scheduleDateHelp
                                : "If disabled, the campaign starts immediately."
                            }
                          />
                          {customStartEnabled ? (
                            <BlockStack gap="200">
                              <InlineStack gap="300" align="start" wrap>
                                <div style={{ minWidth: 220 }}>
                                  <TextField
                                    label="Start date"
                                    value={startsAtDate}
                                    onChange={setStartsAtDate}
                                    autoComplete="off"
                                    placeholder="YYYY-MM-DD"
                                    helpText="Use the YYYY-MM-DD format."
                                    error={
                                      startsAtDate && !isIsoDate(startsAtDate)
                                        ? "Enter a valid date in YYYY-MM-DD."
                                        : undefined
                                    }
                                  />
                                </div>
                                <div style={{ minWidth: 160 }}>
                                  <TextField
                                    label="Start time"
                                    value={startsAtTime}
                                    onChange={setStartsAtTime}
                                    autoComplete="off"
                                    placeholder="09:00"
                                    helpText="Use 24-hour time."
                                    error={
                                      startsAtTime && !isIsoTime(startsAtTime)
                                        ? "Enter a valid time in HH:MM."
                                        : undefined
                                    }
                                  />
                                </div>
                              </InlineStack>
                              <InlineStack gap="200" wrap>
                                <Button
                                  onClick={() => {
                                    const preset = addDaysToLocalParts(7);
                                    setStartsAtDate(preset.date);
                                    setStartsAtTime(preset.time);
                                  }}
                                >
                                  Start in 7 days
                                </Button>
                                <Button
                                  onClick={() => {
                                    const preset = addDaysToLocalParts(30);
                                    setStartsAtDate(preset.date);
                                    setStartsAtTime(preset.time);
                                  }}
                                >
                                  Start in 30 days
                                </Button>
                              </InlineStack>
                            </BlockStack>
                          ) : null}

                          <Checkbox
                            label="Set an end date"
                            checked={customEndEnabled}
                            onChange={(checked) => {
                              setCustomEndEnabled(checked);
                              if (!checked) {
                                setEndsAtDate("");
                                setEndsAtTime("23:59");
                              }
                            }}
                            helpText={
                              customEndEnabled
                                ? scheduleDateHelp
                                : "If disabled, the campaign stays live until you deactivate it."
                            }
                          />
                          {customEndEnabled ? (
                            <BlockStack gap="200">
                              <InlineStack gap="300" align="start" wrap>
                                <div style={{ minWidth: 220 }}>
                                  <TextField
                                    label="End date"
                                    value={endsAtDate}
                                    onChange={setEndsAtDate}
                                    autoComplete="off"
                                    placeholder="YYYY-MM-DD"
                                    helpText="Use the YYYY-MM-DD format."
                                    error={
                                      endsAtDate && !isIsoDate(endsAtDate)
                                        ? "Enter a valid date in YYYY-MM-DD."
                                        : undefined
                                    }
                                  />
                                </div>
                                <div style={{ minWidth: 160 }}>
                                  <TextField
                                    label="End time"
                                    value={endsAtTime}
                                    onChange={setEndsAtTime}
                                    autoComplete="off"
                                    placeholder="23:59"
                                    helpText="Use 24-hour time."
                                    error={
                                      endsAtTime && !isIsoTime(endsAtTime)
                                        ? "Enter a valid time in HH:MM."
                                        : undefined
                                    }
                                  />
                                </div>
                              </InlineStack>
                              <InlineStack gap="200" wrap>
                                <Button
                                  onClick={() => {
                                    const preset = addDaysToLocalParts(7);
                                    setEndsAtDate(preset.date);
                                    setEndsAtTime("23:59");
                                  }}
                                >
                                  End in 7 days
                                </Button>
                                <Button
                                  onClick={() => {
                                    const preset = addDaysToLocalParts(30);
                                    setEndsAtDate(preset.date);
                                    setEndsAtTime("23:59");
                                  }}
                                >
                                  End in 30 days
                                </Button>
                              </InlineStack>
                            </BlockStack>
                          ) : null}
                        </BlockStack>
                      ) : (
                        <Text as="p" variant="bodySm" tone="subdued">
                          This campaign will start immediately and run until you deactivate it.
                        </Text>
                      )}
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>

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
                      <Text as="p" variant="bodySm" tone="subdued">
                        {remainingProductSlots == null
                          ? "Unlimited active product coverage on this plan."
                          : `${remainingProductSlots} active product slot${
                              remainingProductSlots === 1 ? "" : "s"
                            } remaining before you need to upgrade.`}
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

              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Selected collections
                  </Text>
                  <Button onClick={handleOpenCollectionPicker} disabled={!canUseCollections}>
                    {selectedCollections.length > 0 ? "Edit collections" : "Select collections"}
                  </Button>
                </InlineStack>

                {!canUseCollections ? (
                  <Banner tone="info">
                    Collection campaigns are available on Plus and Business. Upgrade
                    in Billing to target collections dynamically.
                  </Banner>
                ) : null}

                {selectedCollections.length > 0 ? (
                  <Card background="bg-surface-secondary">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        {selectedCollections.length} collection
                        {selectedCollections.length === 1 ? "" : "s"} selected
                      </Text>
                      <List>
                        {selectedCollections.map((collection) => (
                          <List.Item key={collection.collectionGid}>
                            {collection.collectionTitle ?? collection.collectionGid}
                            {collection.collectionHandle
                              ? ` (${collection.collectionHandle})`
                              : ""}
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  </Card>
                ) : (
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No collections selected yet. Add a collection if you want this
                      campaign to follow collection membership dynamically.
                    </Text>
                  </Box>
                )}
              </BlockStack>

              <Card background="bg-surface-secondary">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Coverage summary
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {selectedProducts.length} selected product
                    {selectedProducts.length === 1 ? "" : "s"} and {selectedCollections.length} selected
                    collection{selectedCollections.length === 1 ? "" : "s"}.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    This campaign is currently projected to cover {selectedCoverageCount} product
                    {selectedCoverageCount === 1 ? "" : "s"}.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {isUnlimitedPlan
                      ? `${usage.activeCampaignCount} active campaigns currently cover ${usage.activeProductCount} unique products.`
                      : `${usage.activeCampaignCount} of ${planConfig.activeCampaignLimit} active campaigns used. ${usage.activeProductCount} of ${planConfig.activeProductLimit} active products currently covered.`}
                  </Text>
                  {coverageMessage ? (
                    <Text as="p" variant="bodySm" tone={liveCoverageSummary?.collectionResolutionFailed ? "subdued" : "critical"}>
                      {coverageMessage}
                    </Text>
                  ) : null}
                  {initialValues?.currentCoverageCount != null ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      This campaign currently covers {initialValues.currentCoverageCount} product
                      {initialValues.currentCoverageCount === 1 ? "" : "s"}.
                    </Text>
                  ) : null}
                </BlockStack>
              </Card>

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
