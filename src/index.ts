
// EXPRESS
import express, { Request, Response, NextFunction } from "express";

// CONFIG
import { config } from "./config";

// SERVICES
import { loadRawData } from "./services/dataLoader";
import { classifyDepartments } from "./services/llm";

// ROUTER
import { createQueryRouter } from "./routes/query";

// TYPES
import {
  DataStore,
  CompanyData,
  Person,
  JobPosting,
  QueryError,
  ErrorCode,
  QueryErrorResponse,
} from "./types";

//* Used to enrich raw data by classifying job titles into departments and building a structured data store. 
const buildDataStore = async (): Promise<DataStore> => {
  const rawData = loadRawData();

  // Collect All Titles for Classification
  const allTitles: string[] = [];
  for (const company of rawData.companies.values()) {
    for (const person of company.people) {
      allTitles.push(person.title);
    }
    for (const job of company.jobs) {
      allTitles.push(job.title);
    }
  }

  const departmentMap = await classifyDepartments(allTitles);

  // Build Enriched Store
  const companies = new Map<string, CompanyData>();

  for (const [accountUrl, rawCompany] of rawData.companies) {
    const people: Person[] = rawCompany.people.map((p) => ({
      ...p,
      department: departmentMap.get(p.title) ?? "Other",
    }));

    const jobs: JobPosting[] = rawCompany.jobs.map((j) => ({
      ...j,
      department: departmentMap.get(j.title) ?? "Other",
    }));

    companies.set(accountUrl, {
      account: rawCompany.account,
      people,
      jobs,
    });
  }

  return {
    companies,
    companyNameIndex: rawData.companyNameIndex,
  };
};

//* Starts the Express server. 
const startServer = async (): Promise<void> => {
  console.log("Starting server...\n");

  const store = await buildDataStore();

  const app = express();
  app.use(express.json());

  // Routes
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use("/query", createQueryRouter(store));

  // Error - Handling Middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof QueryError) {
      const errorResponse: QueryErrorResponse = {
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      };
      res.status(err.statusCode).json(errorResponse);
      return;
    }

    console.error("Unhandled error:", err);
    const errorResponse: QueryErrorResponse = {
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: "An unexpected error occurred.",
      },
    };
    res.status(500).json(errorResponse);
  });

  app.listen(config.port, () => {
    console.log(`\nServer running on http://localhost:${config.port}`);
    console.log("POST /query — send natural language questions");
    console.log("GET /health — health check\n");
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});