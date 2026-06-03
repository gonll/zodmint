// 17-tanstack-query.ts — zodmint/tanstack-query: pre-populate QueryClient cache for tests
import { z } from "zod";
import { mockQueryClient, mockQueryFn, mockInfiniteQueryClient } from "../src/tanstack-query.js";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

const PostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  userId: z.string().uuid(),
});

// Pre-populate cache — no network, no fetch mock needed
const client = mockQueryClient([
  { queryKey: ["user", "1"], schema: UserSchema, options: { seed: 1 } },
  { queryKey: ["posts"],     schema: z.array(PostSchema), options: { seed: 2 } },
]);

console.log("user:", client.getQueryData(["user", "1"]));
console.log("posts:", client.getQueryData(["posts"]));

// queryFn replacement — use inside useQuery in tests
const queryFn = mockQueryFn(UserSchema, { seed: 42 });
console.log("queryFn result:", queryFn());

// Infinite query
const infiniteClient = mockInfiniteQueryClient([
  { queryKey: ["feed"], schema: PostSchema, pageSize: 3 },
]);
const feed = infiniteClient.getQueryData(["feed"]) as { pages: unknown[][]; pageParams: unknown[] };
console.log("pages:", feed.pages.length, "items per page:", feed.pages[0].length);
