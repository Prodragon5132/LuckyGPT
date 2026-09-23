import { z } from "zod";

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  instructions: z.string().max(8000).default(""),
  color: z.string().max(20).default(""),
});

export const gptSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).default(""),
  instructions: z.string().max(8000).default(""),
  starters: z.array(z.string().max(300)).max(6).default([]),
  icon: z.string().max(16).default("✨"),
  color: z.string().max(20).default(""),
  modelId: z.string().max(100).nullable().default(null),
  capabilities: z.object({ search: z.boolean(), image: z.boolean() }).default({ search: true, image: true }),
  pinned: z.boolean().optional(),
});
