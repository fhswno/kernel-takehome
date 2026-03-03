// -- DEPARMENT TAXONOMY --

export const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Design",
  "Data",
  "Sales",
  "Marketing",
  "Customer Success",
  "Support",
  "HR / People",
  "Finance",
  "Legal",
  "Operations",
  "IT",
  "Security",
  "Quality Assurance",
  "Research & Development",
  "Supply Chain / Logistics",
  "Manufacturing / Production",
  "Executive / Leadership",
  "Other",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

// -- DATA MODELS --

export interface Account {
  accountUrl: string;
  companyName: string;
  city: string;
  country: string;
  employeeCountByCountry: Record<string, number>;
  description: string;
  foundedYear: number | null;
  headcount: number;
  industry: string;
  linkedinUrl: string;
}

export interface Person {
  accountUrl: string;
  index: number;
  title: string;
  headline: string;
  summary: string;
  country: string;
  department: Department;
}

export interface JobPosting {
  accountUrl: string;
  title: string;
  description: string;
  datePosted: string;
  validThrough: string;
  employmentType: string;
  location: string;
  department: Department;
}

// -- IN-MEMORY DATA STORE --

export interface CompanyData {
  account: Account;
  people: Person[];
  jobs: JobPosting[];
}

export interface DataStore {
  companies: Map<string, CompanyData>;
  companyNameIndex: Map<string, string>;
}

// -- QUERY CLASSIFICATION --

export enum QueryIntent {
  EMPLOYEE_COUNT_BY_COUNTRY = "EMPLOYEE_COUNT_BY_COUNTRY",
  HIRING_DEPARTMENTS = "HIRING_DEPARTMENTS",
  DEPARTMENT_HEADCOUNT = "DEPARTMENT_HEADCOUNT",
}

export interface ClassifiedQuery {
  intent: QueryIntent;
  companyName: string;
  country: string | null;
  department: string | null;
}

// -- API RESPONSE --

export interface QuerySuccessResponse {
  success: true;
  query: string;
  intent: QueryIntent;
  company: string;
  result: EmployeeCountResult | HiringDepartmentsResult | DepartmentHeadcountResult;
}

export interface EmployeeCountResult {
  type: "employee_count_by_country";
  country: string;
  count: number;
}

export interface HiringDepartmentsResult {
  type: "hiring_departments";
  departments: string[];
}

export interface DepartmentHeadcountResult {
  type: "department_headcount";
  department: string;
  count: number;
}

// -- ERROR HANDLING --

export enum ErrorCode {
  COMPANY_NOT_FOUND = "COMPANY_NOT_FOUND",
  INTENT_NOT_RECOGNIZED = "INTENT_NOT_RECOGNIZED",
  MISSING_ENTITY = "MISSING_ENTITY",
  DEPARTMENT_NOT_FOUND = "DEPARTMENT_NOT_FOUND",
  LLM_FAILURE = "LLM_FAILURE",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

//* Represents an error occuring during query processing, with a given error code and message. */
export class QueryError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "QueryError";
  }
}

export interface QueryErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
  };
}

// -- RAW DATA - PRE-CLASSIFICATION --

export type RawPerson = Omit<Person, "department">;

export type RawJobPosting = Omit<JobPosting, "department">;

export interface RawCompanyData {
  account: Account;
  people: RawPerson[];
  jobs: RawJobPosting[];
}

export interface RawDataStore {
  companies: Map<string, RawCompanyData>;
  companyNameIndex: Map<string, string>;
}
