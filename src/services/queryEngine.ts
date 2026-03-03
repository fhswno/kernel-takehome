// TYPES
import {
  DataStore,
  ClassifiedQuery,
  QueryIntent,
  QueryError,
  ErrorCode,
  EmployeeCountResult,
  HiringDepartmentsResult,
  DepartmentHeadcountResult,
  QueryResult,
  DEPARTMENTS,
  Person,
} from "../types";

//* Used to resolve a company name extracted from the query into the corresponding account URL, using a pre-built index. Throws an error if no match is found.
const resolveCompany = (
  companyName: string,
  companyNameIndex: Map<string, string>
): string => {
  const normalized = companyName.toLowerCase().trim();
  const accountUrl = companyNameIndex.get(normalized);

  if (!accountUrl) {
    const available = [...new Set(companyNameIndex.values())]
      .map((url: string) => {
        for (const [name, u] of companyNameIndex) {
          if (u === url) return name;
        }
        return url;
      });

    throw new QueryError(
      ErrorCode.COMPANY_NOT_FOUND,
      `No company matching "${companyName}" was found. Available companies: ${available.join(", ")}`
    );
  }

  return accountUrl;
};

//* Used to execute Query 1 (Employee count by country) by counting people records that match the specified country. Throws an error if the country entity is missing or if company data is not found after resolution.
const executeEmployeeCountByCountry = (
  store: DataStore,
  accountUrl: string,
  query: ClassifiedQuery
): EmployeeCountResult => {
  if (!query.country) {
    throw new QueryError(
      ErrorCode.MISSING_ENTITY,
      "A country is required for this query but none was identified."
    );
  }

  const companyData = store.companies.get(accountUrl);
  if (!companyData) throw new QueryError(ErrorCode.INTERNAL_ERROR, "Company data missing after resolution.", 500);

  const normalizedCountry = query.country.toLowerCase().trim();
  const count = companyData.people.filter(
    (p: Person) => p.country.toLowerCase().trim() === normalizedCountry
  ).length;

  return {
    type: "employee_count_by_country",
    country: query.country,
    count,
  };
};

//* Used to execute Query 2 (Hiring departments) by extracting unique department names from active job postings. Departments are returned in a consistent order based on a predefined taxonomy. Throws an error if company data is not found after resolution. */
const executeHiringDepartments = (
  store: DataStore,
  accountUrl: string
): HiringDepartmentsResult => {
  const companyData = store.companies.get(accountUrl);
  if (!companyData) {
    throw new QueryError(ErrorCode.INTERNAL_ERROR, "Company data missing after resolution.", 500);
  }

  const departments = new Set<string>();
  for (const job of companyData.jobs) {
    departments.add(job.department);
  }

  const sorted = [...departments].sort((a, b) => {
    const indexA = DEPARTMENTS.indexOf(a as typeof DEPARTMENTS[number]);
    const indexB = DEPARTMENTS.indexOf(b as typeof DEPARTMENTS[number]);
    return indexA - indexB;
  });

  return {
    type: "hiring_departments",
    departments: sorted,
  };
};

//* Used to execute Query 3 (Department headcount) by counting people records that match the specified department. The department from the query is matched against a predefined taxonomy to ensure consistency. Throws an error if the department entity is missing, if the department is not recognized, or if company data is not found after resolution. */
const executeDepartmentHeadcount = (
  store: DataStore,
  accountUrl: string,
  query: ClassifiedQuery
): DepartmentHeadcountResult => {
  if (!query.department) {
    throw new QueryError(
      ErrorCode.MISSING_ENTITY,
      "A department is required for this query but none was identified."
    );
  }

  const companyData = store.companies.get(accountUrl);
  if (!companyData) {
    throw new QueryError(ErrorCode.INTERNAL_ERROR, "Company data missing after resolution.", 500);
  }

  // Match against our taxonomy with normalized comparison
  const normalizedQuery = query.department.toLowerCase().trim();
  const matchedDepartment = DEPARTMENTS.find(
    (d) => d.toLowerCase() === normalizedQuery
  );

  if (!matchedDepartment) {
    throw new QueryError(
      ErrorCode.DEPARTMENT_NOT_FOUND,
      `Department "${query.department}" not recognized. Available departments: ${DEPARTMENTS.join(", ")}`
    );
  }

  const count = companyData.people.filter(
    (p) => p.department === matchedDepartment
  ).length;

  return {
    type: "department_headcount",
    department: matchedDepartment,
    count,
  };
};

//* Used to execute a classified query by first resolving the company name to an account URL, then routing to the appropriate handler based on the intent. Each handler is responsible for validating required entities and returning results in a consistent format. Errors are thrown for missing entities, unrecognized departments, or if company data is not found after resolution. */
export const executeQuery = (
  store: DataStore,
  query: ClassifiedQuery
): QueryResult => {
  const accountUrl = resolveCompany(query.companyName, store.companyNameIndex);

  switch (query.intent) {
    case QueryIntent.EMPLOYEE_COUNT_BY_COUNTRY:
      return executeEmployeeCountByCountry(store, accountUrl, query);
    case QueryIntent.HIRING_DEPARTMENTS:
      return executeHiringDepartments(store, accountUrl);
    case QueryIntent.DEPARTMENT_HEADCOUNT:
      return executeDepartmentHeadcount(store, accountUrl, query);
  }
};