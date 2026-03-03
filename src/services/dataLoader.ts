// FILE SYSTEM
import fs from "fs";

// PATH
import path from "path";

// CSV PARSING
import { parse } from "csv-parse/sync";

// CONFIG
import { config } from "../config";

// TYPES
import {
  Account,
  RawPerson,
  RawJobPosting,
  RawCompanyData,
  RawDataStore,
} from "../types";

//* Used to read & parse a CSV file from the given filename (relative path). 
const readCSV = (filename: string): Record<string, string>[] => {
  const filePath = path.join(config.dataDir, filename);
  const content = fs.readFileSync(filePath, "utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

//* Used to get the company name from an account URL, using heuristics to find the most human-friendly name possible.
const companyNameFromDomain = (accountUrl: string): string => {
  const domain = accountUrl.replace(/\.(com|io|ai|org|net)$/, "");
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

//* Used to read & parse accounts from the Accounts CSV, returning a map of account URL to Account objects. 
const parseAccounts = (
  accountRows: Record<string, string>[],
  jobRows: Record<string, string>[]
): Map<string, Account> => {
  const accounts = new Map<string, Account>();

  // Pre-Extract Hiring Organisation Names
  const hiringOrgNames = new Map<string, string>();
  for (const jobRow of jobRows) {
    const accountUrl = jobRow["account_url"] ?? "";
    if (hiringOrgNames.has(accountUrl)) continue;
    try {
      const jobData = JSON.parse(jobRow["job_post_data"] ?? "{}");
      const name = (jobData["hiringOrganization"] as Record<string, unknown>)?.["name"];
      if (typeof name === "string" && name.length > 0) {
        hiringOrgNames.set(accountUrl, name);
      }
    } catch {
      continue;
    }
  }

  for (const row of accountRows) {
    const accountUrl = row["account_url"] ?? "";
    if (!accountUrl) continue;

    let employeeCountByCountry: Record<string, number> = {};
    try {
      employeeCountByCountry = JSON.parse(row["employee_count_by_country"] ?? "{}");
    } catch {
      console.warn(`Failed to parse employee_count_by_country for ${accountUrl}`);
    }

    const account: Account = {
      accountUrl,
      companyName: hiringOrgNames.get(accountUrl) ?? companyNameFromDomain(accountUrl),
      city: row["city"] ?? "",
      country: row["country"] ?? "",
      employeeCountByCountry,
      description: row["description"] ?? "",
      foundedYear: row["founded_year"] ? parseInt(row["founded_year"], 10) : null,
      headcount: parseInt(row["headcount"] ?? "0", 10),
      industry: row["industry"] ?? "",
      linkedinUrl: row["linkedin_url"] ?? "",
    };

    if (accounts.has(accountUrl)) {
      throw new Error(`Duplicate account_url detected: ${accountUrl}`);
    }

    accounts.set(accountUrl, account);
  }

  return accounts;
}

//* Used to read & parse people from the People CSV, returning a map of account URL to arrays of RawPerson objects.
const parsePeople = (validAccountUrls: Set<string>): Map<string, RawPerson[]> => {
  const rows = readCSV("tech_test_people.csv");
  const peopleByCompany = new Map<string, RawPerson[]>();

  for (const row of rows) {
    const accountUrl = row["account_url"] ?? "";
    if (!accountUrl || !validAccountUrls.has(accountUrl)) continue;

    const person: RawPerson = {
      accountUrl,
      index: parseInt(row["index"] ?? "0", 10),
      title: row["title"] ?? "",
      headline: row["headline"] ?? "",
      summary: row["summary"] ?? "",
      country: row["country"]?.trim() ?? "",
    };

    const existing = peopleByCompany.get(accountUrl);
    if (existing) {
      existing.push(person);
    } else {
      peopleByCompany.set(accountUrl, [person]);
    }
  }

  return peopleByCompany;
}

//* Used to read & parse job locations from the Jobs CSV, returning a map of account URL to arrays of RawJobPosting objects.
const extractJobLocation = (jobData: Record<string, unknown>): string => {
  try {
    const loc = jobData["jobLocation"] as Record<string, unknown> | undefined;
    if (!loc) return "";
    const address = loc["address"] as Record<string, string> | undefined;
    if (!address) return "";
    const parts = [
      address["addressLocality"],
      address["addressRegion"],
      address["addressCountry"],
    ].filter(Boolean);
    return parts.join(", ");
  } catch {
    return "";
  }
}

//* Used to read & parse jobs from the Jobs CSV, returning a map of account URL to arrays of RawJobPosting objects.
const parseJobs = (validAccountUrls: Set<string>): {
  jobsByCompany: Map<string, RawJobPosting[]>;
  rawRows: Record<string, string>[];
} => {
  const rawRows = readCSV("tech_task_jobs.csv");
  const jobsByCompany = new Map<string, RawJobPosting[]>();

  for (const row of rawRows) {
    const accountUrl = row["account_url"] ?? "";
    if (!accountUrl || !validAccountUrls.has(accountUrl)) continue;

    let jobData: Record<string, unknown> = {};
    try {
      jobData = JSON.parse(row["job_post_data"] ?? "{}");
    } catch {
      console.warn(`Failed to parse job_post_data for row in ${accountUrl}`);
      continue;
    }

    const title = String(jobData["title"] ?? "").trim();
    if (!title) continue;

    const job: RawJobPosting = {
      accountUrl,
      title,
      description: String(jobData["description"] ?? ""),
      datePosted: String(jobData["datePosted"] ?? ""),
      validThrough: String(jobData["validThrough"] ?? ""),
      employmentType: String(jobData["employmentType"] ?? ""),
      location: extractJobLocation(jobData),
    };

    const existing = jobsByCompany.get(accountUrl);
    if (existing) {
      existing.push(job);
    } else {
      jobsByCompany.set(accountUrl, [job]);
    }
  }

  return { jobsByCompany, rawRows };
}

//* Used to build a company name index mapping normalized company names and domains to account URLs, to avoid collisions.
const buildCompanyNameIndex = (accounts: Map<string, Account>): Map<string, string> => {
  const index = new Map<string, string>();

  for (const [accountUrl, account] of accounts) {
    const normalizedName = account.companyName.toLowerCase().trim();
    const normalizedDomain = accountUrl.replace(/\.(com|io|ai|org|net)$/, "").toLowerCase();

    if (index.has(normalizedName) && index.get(normalizedName) !== accountUrl) {
      throw new Error(
        `Company name collision: "${normalizedName}" maps to both ` +
          `${index.get(normalizedName)} and ${accountUrl}`
      );
    }
    index.set(normalizedName, accountUrl);

    if (!index.has(normalizedDomain)) {
      index.set(normalizedDomain, accountUrl);
    }
  }

  return index;
}

//* Used to load and parse all CSV data into an in-memory data store, returning a RawDataStore object containing maps of companies and company name index.
export const loadRawData = (): RawDataStore => {
  console.log("Loading CSV data...");

  const accountRows = readCSV("tech_test_accounts.csv");
  const validAccountUrls = new Set(
    accountRows.map((row) => row["account_url"] ?? "").filter(Boolean)
  );

  const { jobsByCompany, rawRows: jobRawRows } = parseJobs(validAccountUrls);
  const accounts = parseAccounts(accountRows, jobRawRows);
  const peopleByCompany = parsePeople(validAccountUrls);

  const companies = new Map<string, RawCompanyData>();

  for (const [accountUrl, account] of accounts) {
    companies.set(accountUrl, {
      account,
      people: peopleByCompany.get(accountUrl) ?? [],
      jobs: jobsByCompany.get(accountUrl) ?? [],
    });
  }

  const companyNameIndex = buildCompanyNameIndex(accounts);

  let totalPeople = 0;
  let totalJobs = 0;
  for (const data of companies.values()) {
    totalPeople += data.people.length;
    totalJobs += data.jobs.length;
  }

  console.log(`  Loaded ${accounts.size} accounts`);
  console.log(`  Loaded ${totalPeople} people`);
  console.log(`  Loaded ${totalJobs} job postings`);
  console.log(`  Company name index: ${companyNameIndex.size} entries`);

  return { companies, companyNameIndex };
}
