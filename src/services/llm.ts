// OPENAI
import OpenAI from "openai";

// CONFIG
import { config } from "../config";

// TYPES
import {
  DEPARTMENTS,
  Department,
  QueryIntent,
  ClassifiedQuery,
  ErrorCode,
  QueryError,
  ClassificationItem
} from "../types";

// OPENAI CLIENT
const openai = new OpenAI({ apiKey: config.openaiApiKey });

// DEPARTMENT LIST
const DEPARTMENT_LIST = DEPARTMENTS.join(", ");

// CONSTANT - BATCH SIZE
const CLASSIFICATION_BATCH_SIZE = 50;

//* Used to classify a batch of job titles into departments. The LLM is prompted with a list of titles and must respond with a JSON array mapping each title to exactly one department.
const buildClassificationPrompt = (titles: string[]): string => {
  const numbered = titles.map((t: string, i: number) => `${i}: ${t}`).join("\n");
  return `Classify each job title into exactly one department from this list:
${DEPARTMENT_LIST}

Titles:
${numbered}

Respond with a JSON array of objects, one per title, in the same order.
Each object must have: { "index": number, "department": string }
The department must be exactly one of the listed departments.
Respond ONLY with the JSON array, no other text.`;
};

//* Used to parse the LLM response for department classification, ensuring it is valid JSON and matches the expected structure. Returns a mapping of title index to department.
const parseClassificationResponse = (
  content: string,
  batchSize: number
): Map<number, Department> => {
  const cleaned = content.replace(/```json\s*|```/g, "").trim();
  const parsed: unknown = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error("Classification response is not an array");
  }

  const result = new Map<number, Department>();
  const validDepartments = new Set<string>(DEPARTMENTS);

  for (const item of parsed as ClassificationItem[]) {
    if (
      typeof item.index !== "number" ||
      typeof item.department !== "string"
    ) {
      continue;
    }

    const department = validDepartments.has(item.department)
      ? (item.department as Department)
      : "Other";

    result.set(item.index, department);
  }

  return result;
};

//* Used to classify a list of job titles into departments, using the LLM in batches to handle large lists while respecting token limits. Returns a mapping of title to department.
export const classifyDepartments = async (
  titles: string[]
): Promise<Map<string, Department>> => {
  // Deduplicate Titles
  const uniqueTitles = [...new Set(titles)];
  const titleToDepartment = new Map<string, Department>();

  console.log(
    `Classifying ${uniqueTitles.length} unique titles (from ${titles.length} total)...`
  );

  // Batch Processing
  for (let i = 0; i < uniqueTitles.length; i += CLASSIFICATION_BATCH_SIZE) {
    const batch = uniqueTitles.slice(i, i + CLASSIFICATION_BATCH_SIZE);
    const batchNumber = Math.floor(i / CLASSIFICATION_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(
      uniqueTitles.length / CLASSIFICATION_BATCH_SIZE
    );

    console.log(`  Batch ${batchNumber}/${totalBatches} (${batch.length} titles)...`);

    try {
      const response = await openai.chat.completions.create({
        model: config.llmModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a precise classifier. You map job titles to departments. Respond only with valid JSON.",
          },
          {
            role: "user",
            content: buildClassificationPrompt(batch),
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from LLM");
      }

      const classifications = parseClassificationResponse(content, batch.length);

      for (let j = 0; j < batch.length; j++) {
        const department = classifications.get(j) ?? "Other";
        titleToDepartment.set(batch[j], department);
      }
    } catch (error) {
      console.error(`  Batch ${batchNumber} failed, defaulting to "Other":`, error);
      for (const title of batch) {
        titleToDepartment.set(title, "Other");
      }
    }
  }

  console.log(`  Classification complete: ${titleToDepartment.size} titles mapped`);
  return titleToDepartment;
};

// CONSTANT - SYSTEM PROMPT (INTENT CLASSIFICATION)
const INTENT_SYSTEM_PROMPT = `You classify natural language questions about companies into structured queries.

Available intents:
- EMPLOYEE_COUNT_BY_COUNTRY: Questions about how many employees a company has in a specific country.
- HIRING_DEPARTMENTS: Questions about which departments a company is hiring in.
- DEPARTMENT_HEADCOUNT: Questions about how many people are in a specific department at a company.

Extract the intent, company name, country (if relevant), and department (if relevant).

Respond ONLY with a JSON object:
{
  "intent": "EMPLOYEE_COUNT_BY_COUNTRY" | "HIRING_DEPARTMENTS" | "DEPARTMENT_HEADCOUNT",
  "companyName": "string",
  "country": "string or null",
  "department": "string or null"
}

No other text.`;

//* Used to classify a natural language query into a structured format, extracting the intent, company name, and any relevant entities like country or department.
export const classifyQuery = async (query: string): Promise<ClassifiedQuery> => {
  try {
    const response = await openai.chat.completions.create({
      model: config.llmModel,
      temperature: 0,
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new QueryError(
        ErrorCode.LLM_FAILURE,
        "Empty response from LLM during intent classification",
        502
      );
    }

    const cleaned = content.replace(/```json\s*|```/g, "").trim();
    const parsed: unknown = JSON.parse(cleaned);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("intent" in parsed) ||
      !("companyName" in parsed)
    ) {
      throw new Error("Invalid classification structure");
    }

    const raw = parsed as Record<string, unknown>;

    const intent = raw["intent"];
    if (
      intent !== QueryIntent.EMPLOYEE_COUNT_BY_COUNTRY &&
      intent !== QueryIntent.HIRING_DEPARTMENTS &&
      intent !== QueryIntent.DEPARTMENT_HEADCOUNT
    ) {
      throw new QueryError(
        ErrorCode.INTENT_NOT_RECOGNIZED,
        `Could not determine the type of question being asked. Supported queries: employee count by country, hiring departments, department headcount.`
      );
    }

    const companyName = raw["companyName"];
    if (typeof companyName !== "string" || companyName.length === 0) {
      throw new QueryError(
        ErrorCode.MISSING_ENTITY,
        "Could not identify a company name in the question."
      );
    }

    const country = typeof raw["country"] === "string" && raw["country"].length > 0
      ? raw["country"]
      : null;

    const department = typeof raw["department"] === "string" && raw["department"].length > 0
      ? raw["department"]
      : null;

    return { intent, companyName, country, department };
  } catch (error) {
    if (error instanceof QueryError) throw error;

    throw new QueryError(
      ErrorCode.LLM_FAILURE,
      `Failed to classify query: ${error instanceof Error ? error.message : "Unknown error"}`,
      502
    );
  }
};
