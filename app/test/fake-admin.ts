export type FakeAdminCall = {
  query: string;
  variables?: Record<string, unknown>;
};

export function createFakeAdmin(responses: unknown[]) {
  const queue = [...responses];
  const calls: FakeAdminCall[] = [];

  const admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, variables: options?.variables });

      if (queue.length === 0) {
        throw new Error(`Unexpected Admin API call: ${query.trim().split("\n")[0]}`);
      }

      return new Response(JSON.stringify(queue.shift()));
    },
  };

  return { admin, calls };
}
