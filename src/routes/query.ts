// EXPRESS
import { Router, Request, Response, NextFunction } from "express";

// SERVICES
import { classifyQuery } from "../services/llm";
import { executeQuery } from "../services/queryEngine";

// TYPES
import { DataStore, QueryError, ErrorCode, QuerySuccessResponse } from "../types";

//* Used to create a query router that handles POST requests to the /query endpoint. The router validates the request body, classifies the query using the LLM, executes the classified query against the data store, and returns a structured response.
export const createQueryRouter = (store: DataStore): Router => {
  const router = Router();

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const query = body["query"];

      if (typeof query !== "string" || query.trim().length === 0) {
        throw new QueryError(
          ErrorCode.MISSING_ENTITY,
          'Request body must include a "query" field with a non-empty string.',
        );
      }

      const classified = await classifyQuery(query.trim());
      const result = executeQuery(store, classified);

      const response: QuerySuccessResponse = {
        success: true,
        query: query.trim(),
        intent: classified.intent,
        company: classified.companyName,
        result,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
};