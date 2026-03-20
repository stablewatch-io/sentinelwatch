/**
 * syncAllocationsToGitHub
 * 
 * Ensures each allocation has corresponding GitHub Discussions in multiple categories:
 * - Risk Analysis
 * - Performance Monitoring
 * - Compliance Review
 * 
 * Creates missing discussions automatically on deployment.
 */

import type { APIGatewayProxyHandler } from "aws-lambda";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = "stablewatch-io";
const GITHUB_REPO_NAME = "sentinelwatch-workspace";
const GITHUB_API = "https://api.github.com";

if (!GITHUB_TOKEN) {
  console.warn("GITHUB_TOKEN not set — skipping GitHub sync");
}

const DISCUSSION_CATEGORIES = [
  "Risk Analysis",
  "Settle",
  "Upcoming",
] as const;

type GitHubDiscussion = {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  category: {
    id: string;
    name: string;
  };
};

/**
 * Execute a GitHub GraphQL query
 */
async function graphql(query: string, variables: Record<string, any> = {}): Promise<any> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

/**
 * Fetch repository ID and discussion categories
 */
async function getRepositoryInfo(): Promise<{
  repositoryId: string;
  categories: Array<{ id: string; name: string }>;
}> {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        discussionCategories(first: 10) {
          nodes {
            id
            name
          }
        }
      }
    }
  `;

  const data = await graphql(query, {
    owner: GITHUB_REPO_OWNER,
    name: GITHUB_REPO_NAME,
  });

  return {
    repositoryId: data.repository.id,
    categories: data.repository.discussionCategories.nodes,
  };
}

/**
 * Fetch all discussions for a specific category
 */
async function fetchDiscussionsForCategory(
  repositoryId: string,
  categoryId: string
): Promise<Map<string, GitHubDiscussion>> {
  const discussions = new Map<string, GitHubDiscussion>();
  let cursor: string | null = null;

  while (true) {
    const query = `
      query($repositoryId: ID!, $categoryId: ID!, $cursor: String) {
        node(id: $repositoryId) {
          ... on Repository {
            discussions(first: 100, after: $cursor, categoryId: $categoryId) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                number
                title
                body
                url
                category {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `;

    const data = await graphql(query, { repositoryId, categoryId, cursor });
    const result = data.node.discussions;

    for (const discussion of result.nodes) {
      const match = discussion.body?.match(/<!-- allocation_id:(.*?) -->/);
      if (match) {
        discussions.set(match[1], discussion);
      }
    }

    if (!result.pageInfo.hasNextPage) break;
    cursor = result.pageInfo.endCursor;
  }

  return discussions;
}

/**
 * Create a discussion body with allocation metadata
 */
function createDiscussionBody(
  allocation: {
    id: string;
    name: string;
    star: string;
    protocol: string;
    blockchain: string;
    type: string;
    underlying?: string;
    holdingWallet?: string | null;
    isLending?: boolean | null;
    isLP?: boolean | null;
    isYBS?: boolean | null;
    hasIdle?: boolean | null;
    isIdle?: boolean | null;
    hasRRC?: boolean | null;
  },
  categoryName: string
): string {
  let categoryIntro = "";
  
  switch (categoryName) {
    case "Risk Analysis":
      categoryIntro = "Discuss risk factors, exposures, and mitigation strategies for this allocation.";
      break;
    case "Settle":
      categoryIntro = "Discuss settlement processes, execution plans, and operational details for this allocation.";
      break;
    case "Upcoming":
      categoryIntro = "Discuss upcoming changes, planned updates, and future considerations for this allocation.";
      break;
  }

  return `## ${allocation.name}

${categoryIntro}

### Allocation Details

- **Star:** ${allocation.star}
- **Protocol:** ${allocation.protocol}
- **Blockchain:** ${allocation.blockchain}
- **Type:** ${allocation.type}
${allocation.underlying ? `- **Underlying:** \`${allocation.underlying}\`` : ""}
${allocation.holdingWallet ? `- **Holding Wallet:** \`${allocation.blockchain}:${allocation.holdingWallet}\`` : ""}

### Flags

${allocation.isLending ? "- Lending position" : ""}
${allocation.isLP ? "- LP position" : ""}
${allocation.isYBS ? "- Yield-bearing share" : ""}
${allocation.hasIdle ? "- Has idle balances" : ""}
${allocation.isIdle ? "- Treated as idle asset" : ""}
${allocation.hasRRC ? "- Has RRC oversight" : ""}

---

<!-- allocation_id:${allocation.id} -->

Add labels and comments specific to ${categoryName.toLowerCase()}.`;
}

/**
 * Create a new GitHub discussion for an allocation in a specific category
 */
async function createDiscussion(
  allocation: {
    id: string;
    name: string;
    star: string;
    protocol: string;
    blockchain: string;
    type: string;
    underlying?: string;
    holdingWallet?: string | null;
    isLending?: boolean | null;
    isLP?: boolean | null;
    isYBS?: boolean | null;
    hasIdle?: boolean | null;
    isIdle?: boolean | null;
    hasRRC?: boolean | null;
  },
  repositoryId: string,
  categoryId: string,
  categoryName: string
): Promise<void> {
  const body = createDiscussionBody(allocation, categoryName);

  const mutation = `
    mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {
        repositoryId: $repositoryId,
        categoryId: $categoryId,
        title: $title,
        body: $body
      }) {
        discussion {
          id
          number
          url
        }
      }
    }
  `;

  const data = await graphql(mutation, {
    repositoryId,
    categoryId,
    title: allocation.id,
    body,
  });

  const discussion = data.createDiscussion.discussion;
  console.log(`  ✓ Created discussion #${discussion.number} in ${categoryName} for ${allocation.id}`);
}

/**
 * Main sync logic
 */
async function syncAllocations(): Promise<{
  totalAllocations: number;
  totalCategories: number;
  expectedDiscussions: number;
  existingDiscussions: number;
  created: number;
  errors: string[];
}> {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  console.log("Fetching allocations from config...");
  const activeAllocations = allocations.filter(isActiveAllocation);
  console.log(`Found ${activeAllocations.length} active allocations`);

  console.log("Fetching repository info and categories...");
  const repoInfo = await getRepositoryInfo();
  console.log(`Repository ID: ${repoInfo.repositoryId}`);
  console.log(`Found ${repoInfo.categories.length} categories: ${repoInfo.categories.map(c => c.name).join(", ")}`);

  // Validate required categories exist
  const categoryMap = new Map(repoInfo.categories.map(c => [c.name, c.id]));
  const missingCategories = DISCUSSION_CATEGORIES.filter(name => !categoryMap.has(name));
  
  if (missingCategories.length > 0) {
    throw new Error(
      `Missing required discussion categories: ${missingCategories.join(", ")}\n` +
      `Please create these categories manually in the repository settings.`
    );
  }

  console.log("Fetching existing discussions for all categories...");
  const existingDiscussionsByCategory = new Map<string, Map<string, GitHubDiscussion>>();
  
  for (const categoryName of DISCUSSION_CATEGORIES) {
    const categoryId = categoryMap.get(categoryName)!;
    const discussions = await fetchDiscussionsForCategory(repoInfo.repositoryId, categoryId);
    existingDiscussionsByCategory.set(categoryName, discussions);
    console.log(`  ${categoryName}: ${discussions.size} discussions found`);
  }

  console.log("\nSyncing allocations to discussions...");
  const errors: string[] = [];
  let created = 0;
  let existing = 0;

  for (const allocation of activeAllocations) {
    console.log(`\n[${allocation.id}]`);
    
    for (const categoryName of DISCUSSION_CATEGORIES) {
      const categoryId = categoryMap.get(categoryName)!;
      const existingInCategory = existingDiscussionsByCategory.get(categoryName)!;

      if (existingInCategory.has(allocation.id)) {
        console.log(`  ✓ ${categoryName} — discussion exists`);
        existing++;
        continue;
      }

      try {
        await createDiscussion(allocation, repoInfo.repositoryId, categoryId, categoryName);
        created++;
        
        // Rate limit: GitHub GraphQL allows ~5000 requests/hour
        // Add small delay to avoid hitting secondary rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${categoryName} — failed: ${message}`);
        errors.push(`${allocation.id} [${categoryName}]: ${message}`);
      }
    }
  }

  const expectedTotal = activeAllocations.length * DISCUSSION_CATEGORIES.length;

  return {
    totalAllocations: activeAllocations.length,
    totalCategories: DISCUSSION_CATEGORIES.length,
    expectedDiscussions: expectedTotal,
    existingDiscussions: existing,
    created,
    errors,
  };
}

/**
 * Lambda handler
 */
const handler: APIGatewayProxyHandler = async () => {
  try {
    const result = await syncAllocations();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        ...result,
      }),
    };
  } catch (err) {
    console.error("syncAllocationsToGitHub failed:", err);
    const message = err instanceof Error ? err.message : String(err);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: false,
        error: message,
      }),
    };
  }
};

export default handler;
