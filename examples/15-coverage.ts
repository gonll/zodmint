// 15-coverage.ts — mockAll: boundary-set generation
import { z } from "zod";
import { mockAll } from "zodmint";

const AgeSchema = z.number().int().min(18).max(100);
console.log("ages:", mockAll(AgeSchema));

const RoleSchema = z.enum(["admin", "user", "guest"]);
console.log("roles:", mockAll(RoleSchema));

console.log("booleans:", mockAll(z.boolean()));

const MaybeStr = z.string().optional();
console.log("optional:", mockAll(MaybeStr));

const IdSchema = z.union([z.string().uuid(), z.number().int().positive()]);
console.log("ids:", mockAll(IdSchema));
