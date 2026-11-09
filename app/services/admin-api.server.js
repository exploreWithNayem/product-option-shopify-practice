// Thin helpers around the Admin GraphQL client.

/**
 * Run an Admin GraphQL operation and return `data`, throwing on top-level errors.
 * @param {{ graphql: Function }} admin
 * @param {string} query
 * @param {Record<string, any>} [variables]
 */
export async function gql(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const msg = Array.isArray(json.errors) ? json.errors.map((e) => e.message).join("; ") : String(json.errors);
    throw new Error(msg);
  }
  return json.data;
}

/** Throw if a mutation payload carries userErrors. */
export function assertNoUserErrors(payload, what) {
  const errs = payload?.userErrors || [];
  if (errs.length) {
    throw new Error(`${what}: ${errs.map((e) => e.message).join("; ")}`);
  }
  return payload;
}

/** Split an array into chunks. */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
