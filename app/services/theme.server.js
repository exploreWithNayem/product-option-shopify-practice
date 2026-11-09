// Theme compatibility checks (PRD A2/A7): is the app embed on, and is the app
// block on the product template? Read-only (read_themes); we never write theme files.

import { gql } from "./admin-api.server";

export const EMBED_HANDLE = "options-embed";
export const BLOCK_HANDLE = "product-options";

const THEME_FILES = `#graphql
  query ShineThemeFiles {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        name
        files(filenames: ["config/settings_data.json", "templates/product.json", "templates/product.liquid"], first: 3) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

function stripJsonComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** @returns {Promise<{ theme: string|null, embedOn: boolean, blockOn: boolean, os2: boolean, error?: string }>} */
export async function themeStatus(admin) {
  try {
    const data = await gql(admin, THEME_FILES);
    const theme = data.themes.nodes[0];
    if (!theme) return { theme: null, embedOn: false, blockOn: false, os2: false };
    const files = Object.fromEntries(theme.files.nodes.map((f) => [f.filename, f.body?.content || ""]));
    let embedOn = false;
    const settings = files["config/settings_data.json"];
    if (settings) {
      try {
        const json = JSON.parse(stripJsonComments(settings));
        const blocks = json?.current?.blocks || {};
        embedOn = Object.values(blocks).some(
          (b) => typeof b?.type === "string" && b.type.includes(`/blocks/${EMBED_HANDLE}/`) && !b.disabled,
        );
      } catch {
        embedOn = new RegExp(`/blocks/${EMBED_HANDLE}/[^"]*"\\s*,\\s*"disabled"\\s*:\\s*false`).test(settings);
      }
    }
    const productJson = files["templates/product.json"];
    const blockOn = !!productJson && productJson.includes(`/blocks/${BLOCK_HANDLE}/`);
    return { theme: theme.name, embedOn, blockOn, os2: !!productJson };
  } catch (e) {
    return { theme: null, embedOn: false, blockOn: false, os2: false, error: String(e?.message || e) };
  }
}

/** Theme editor deep links. */
export function themeLinks(shop) {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const base = `https://${shop}/admin/themes/current/editor`;
  return {
    embed: `${base}?context=apps&activateAppId=${apiKey}/${EMBED_HANDLE}`,
    block: `${base}?template=product&addAppBlockId=${apiKey}/${BLOCK_HANDLE}&target=mainSection`,
    editor: base,
  };
}
