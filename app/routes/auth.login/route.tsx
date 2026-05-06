import type { LoaderFunctionArgs } from "@remix-run/node";
import { AppProvider as PolarisAppProvider, Card, Page, Text } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async (_args: LoaderFunctionArgs) => {
  return { polarisTranslations };
};

export default function Auth() {
  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <Text variant="headingMd" as="h2">
              Open Discounto from Shopify
            </Text>
            <Text as="p" variant="bodyMd">
              Discounto starts from Shopify-owned surfaces such as the Shopify
              App Store or Shopify Admin. Open the app from there to continue
              securely.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              No manual shop-domain entry is required.
            </Text>
          </div>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
