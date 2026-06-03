// 19-trpc.ts — zodmint/trpc: mock callers for tRPC procedure testing
import { z } from "zod";
import { mockTrpcCaller, mockProcedureOutput } from "zodmint/trpc";

const UserSchema = z.object({
  id:    z.string().uuid(),
  name:  z.string(),
  email: z.string().email(),
  role:  z.enum(["admin", "user"]),
});

const PostSchema = z.object({
  id:      z.string().uuid(),
  title:   z.string(),
  userId:  z.string().uuid(),
});

// --- mockTrpcCaller: mock a full router's procedures ---
const caller = mockTrpcCaller({
  "users.getById":  UserSchema,
  "users.list":     z.array(UserSchema),
  "posts.create":   { schema: PostSchema, options: { seed: 1 } },
});

const user  = await (caller as any).users.getById({ id: "1" });
const users = await (caller as any).users.list();
const post  = await (caller as any).posts.create({ title: "Hello" });

console.log("user:",  user);
console.log("users:", users);
console.log("post:",  post);

// --- mockProcedureOutput: one-off synchronous output generation ---
const output = mockProcedureOutput(UserSchema, { seed: 42 });
console.log("procedure output:", output);
