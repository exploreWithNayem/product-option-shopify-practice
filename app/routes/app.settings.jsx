import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { themeLinks, themeStatus } from "../services/theme.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  return {
    theme: await themeStatus(admin),
    links: themeLinks(session.shop),
  };
};

function StatusRow({ ok, label, okText, badText, href, action }) {
  return (
    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
      <s-stack gap="small-100">
        <s-text type="strong">{label}</s-text>
        <s-text color="subdued">{ok ? okText : badText}</s-text>
      </s-stack>
      {ok ? (
        <s-badge tone="success">On</s-badge>
      ) : (
        <s-button href={href} target="_blank">
          {action}
        </s-button>
      )}
    </s-grid>
  );
}

export default function Settings() {
  const d = useLoaderData();

  return (
    <s-page heading="Settings">
      <s-section heading="Theme">
        <s-stack gap="base">
          {d.theme.error ? (
            <s-banner tone="warning">We couldn&apos;t read your theme: {d.theme.error}</s-banner>
          ) : (
            <s-text color="subdued">Live theme: {d.theme.theme || "none"}</s-text>
          )}
          {!d.theme.os2 && !d.theme.error && (
            <s-banner tone="warning">
              Your product template isn&apos;t an Online Store 2.0 template. The app embed still adds options to product pages, but the block can&apos;t be placed.
            </s-banner>
          )}
          <StatusRow
            ok={d.theme.embedOn}
            label="App embed"
            okText="Options are on in your theme."
            badText="Options are off in your theme, so shoppers can't see them."
            href={d.links.embed}
            action="Turn them on"
          />
          <s-divider></s-divider>
          <StatusRow
            ok={d.theme.blockOn}
            label="Product page block"
            okText="The options block is on your product template."
            badText="The options block isn't on your product template yet."
            href={d.links.block}
            action="Add it"
          />
          <s-text color="subdued">
            The app only adds an app block and an app embed. It never edits theme files, so uninstalling leaves your theme as it was.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
