// DOTENV
import dotenv from "dotenv";

// PATH
import path from "path";

// Load environment variable from .env file
dotenv.config();

//* Used to load & validate required env vars.
const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`MISSING ENVIRONMENT VARIABLE: ${key}`);
  return value;
};

//* Config Object
export const config = {
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  port: parseInt(process.env["PORT"] ?? "3000", 10),
  dataDir: path.resolve(__dirname, "../data"),
  llmModel: "gpt-4o-mini" as const,
} as const;
