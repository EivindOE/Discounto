import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => {
  return [
    { title: "Discounto Privacy Policy" },
    {
      name: "description",
      content:
        "Privacy Policy for Discounto, a Shopify app for discount campaign management and storefront badge visibility.",
    },
  ];
};

const sectionStyle = {
  marginTop: "2rem",
};

const paragraphStyle = {
  lineHeight: 1.7,
  marginTop: "0.75rem",
};

export default function PrivacyPolicyPage() {
  return (
    <main
      style={{
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        maxWidth: 840,
        margin: "0 auto",
        padding: "48px 20px 80px",
        color: "#172B4D",
      }}
    >
      <p style={{ margin: 0, color: "#5E6C84", fontSize: "0.95rem" }}>
        Last updated: April 8, 2026
      </p>
      <h1 style={{ marginTop: "0.5rem", fontSize: "2.25rem", lineHeight: 1.1 }}>
        Discounto Privacy Policy
      </h1>
      <p style={paragraphStyle}>
        This Privacy Policy explains how Discounto collects, uses, and stores
        information when merchants install and use the Discounto Shopify app.
      </p>

      <section style={sectionStyle}>
        <h2>1. Information we collect</h2>
        <p style={paragraphStyle}>
          When a merchant installs or uses Discounto, we may collect and store
          information needed to operate the app, including:
        </p>
        <ul style={{ ...paragraphStyle, paddingLeft: "1.25rem" }}>
          <li>Shop domain and Shopify account identifiers</li>
          <li>App session and authentication data provided by Shopify</li>
          <li>Merchant contact details provided by Shopify for app access</li>
          <li>Subscription and billing status related to the app</li>
          <li>Discount campaign settings created in Discounto</li>
          <li>
            Product references used in campaigns, such as product IDs, handles,
            titles, and image URLs
          </li>
          <li>Basic technical logs used for debugging, security, and support</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2>2. How we use information</h2>
        <p style={paragraphStyle}>We use this information to:</p>
        <ul style={{ ...paragraphStyle, paddingLeft: "1.25rem" }}>
          <li>Authenticate merchants and keep the app secure</li>
          <li>Create, sync, update, and remove Shopify discount campaigns</li>
          <li>Show storefront badges, savings text, and related campaign data</li>
          <li>Enforce plan limits and manage app billing state</li>
          <li>Provide customer support and resolve technical issues</li>
          <li>Maintain and improve the app</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2>3. Customer data</h2>
        <p style={paragraphStyle}>
          Discounto is designed to work primarily with merchant, shop, product,
          and campaign data. Discounto does not intentionally collect or store
          customer personal data except where such data may be included in
          Shopify app session or compliance flows provided by Shopify.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2>4. Data sharing</h2>
        <p style={paragraphStyle}>
          We do not sell merchant or store data. We only share data with
          service providers or platforms when required to operate the app, such
          as Shopify for app functionality and infrastructure providers for
          secure hosting, storage, logging, and support.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2>5. Data retention</h2>
        <p style={paragraphStyle}>
          We retain store and campaign data for as long as needed to provide the
          app and comply with legal obligations. If the app is uninstalled or a
          valid deletion request is received, we will delete or anonymize data
          as required by Shopify&apos;s platform rules and applicable law.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2>6. Security</h2>
        <p style={paragraphStyle}>
          We take reasonable technical and organizational measures to protect
          the information processed by Discounto. No method of transmission or
          storage is completely secure, but we work to protect data against
          unauthorized access, misuse, or disclosure.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2>7. Your rights</h2>
        <p style={paragraphStyle}>
          Depending on applicable law, merchants may have rights to access,
          correct, delete, or restrict the use of their data. Shopify merchants
          may also contact us regarding privacy or data handling requests.
        </p>
      </section>

      <section style={sectionStyle}>
        <h2>8. Contact</h2>
        <p style={paragraphStyle}>
          If you have questions about this Privacy Policy or Discounto&apos;s
          handling of data, contact:
        </p>
        <p style={paragraphStyle}>
          Email: eivindokland2006@gmail.com
        </p>
      </section>
    </main>
  );
}
