# Kernel Takehome 🧠

NL API for querying company data. Built using TypeScript, Express, and `GPT-4o-mini`.

## 🤔 How can I run this?

First off, create a `.env` file in the repo root, and add the following:

```
OPENAI_API_KEY={your_key}
PORT={your_preferred_port} // Because we all have something already running on 3000, 8000 or 9000 🫂
```

Once that's done, check you have node installed `node --version` and then install npm dependencies from the repo root:

```bash
npm install
```

Once all dependencies have been installed, you can run the app with the command below:

```bash
npx tsx src/index.ts
```

Startup should take a 2-3 minutes as the server "batch-classifies" all job titles into departments via LLM before accepting requests. When the classification completes, happy days, you can start making requests 🎾

---

## 🧪 How do I test this?

When the server is running, you can use cURL or your preferred API platform to make requests. You would need to send a `POST` request to the `/query` endpoint with a JSON body containing a `query` field. 

```bash
curl -X POST http://localhost:9898/query \
  -H "Content-Type: application/json" \
  -d '{"query": "How many employees does Cloudinary have in Israel?"}'

curl -X POST http://localhost:9898/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What departments is Vibracoustic hiring in?"}'

curl -X POST http://localhost:9898/query \
  -H "Content-Type: application/json" \
  -d '{"query": "How many people in the Engineering department does IntegriChain currently have?"}'
```

All queries above will return deterministic, idempotent and accurate results rooted in the dataset 🥳

The API also handles unknown companies, missing entities, and malformed requests with structured, semantic error responses. For example, if you make the request below, you will receive a semantic error:

```bash
curl -X POST http://localhost:9898/query \
  -H "Content-Type: application/json" \
  -d '{"query": "How many employees does Google have in France?"}'

```

## 🎯 How can we verify accuracy?

Accuracy was validated against a raw CSV data. 

If you make a query with "How many employees does Cloudinary have in Israel?", the API will return `158`, which is correct when couting matching records in the CSV directly:

```bash
python3 -c "
import csv
with open('data/tech_test_people.csv') as f:
    count = sum(1 for r in csv.DictReader(f) if r['account_url'] == 'cloudinary.com' and r['country'].strip() == 'Israel')
    print(count)
"
# Output: 158
```

Idempotency holds because department classification is computed once at startup, then all subsequent queries are deterministically executed against the in-memory store. Running the same query three times returns identical results.

---

## 🏛️ Architecture, Reasoning & Key Decisions

When reading the task description, I immediately understood that accuracy and idempotency is key. As such, using an LLM for counting and data retrieval is a fast pass for hallucinations and innacuracies. 

The LLM is only used for batch department classification at startup, and intent parsing when making requests - not for counting or data retrieval. All answers are computed deterministically, from the in-memory store. 

At startup, the CSV data is loaded into memory, and ALL unique job titles are batch-classified into a fixed 20-department taxonomy using GPT-4o-mini with a temperature set at 0 so the model remains maximally conservative. This mapping is computed once and reused for every request. 

Whenever a request is made, the query is sent to GPT-4o-mini for intent classification and entity extraction _(company, country, department)_. Our deterministic application code then executes the query against the in-memory store; identical queries hence always return identical results. 

Major decisions made include:

- **No department field in the data** - titles like "Senior DevOps Engineer" need to be mapped to departments for Queries 2 & 3. I chose batch classification at startup over runtime because it guarantees idempotency. Runtime classification with the tempature set at 0 would likely be consistent, but "likely" isn't enough when accuracy is essential. A fixed, hardcoded taxonomy of 20 departments ensure titles are classified into a known & bounded set; all titles that can't be confidently classified default to "Other". 

- **Only actual records are counted** - the Accounts CSV reports Cloudinary has 188 employees in Israel while the People CSV only has 158 matching records. I decided to only count actual records as the task requires answers grounded in provided data. 

- **Excluding empty country fields** - 187 people records have no country, and are excluded from country-based counts. 

- **Priorising accuracy over startup speed** - Batch LLM classification is slow, with 2-3 minutes from the run command to the API listening. In production, this would be pre-computed and persisted. 

---

## 🤖 AI Tools

I used Grok 4.1 Fast to help me make important decisions so this can be shipped within 2-3 hours, and check I haven't missed a major component.

I used `gemma-4b` locally (via Ollama, listening on Port `11434`) to run tests on the batch-classification and make sure GPT-4o-mini can indeed correctly classify jobs and map them to department. Gemma 4B was blazing-fast locally, helping me iterate and confirm batch classification is more accurate than runtime classification. 

I used GitHub Copilot's useful autocomplete & comment features to save time when writing code. 

---

## ⏭️ Next Steps & Optimizations

The in-memory approach is fine when dealing with three companies, but won't cut it with thousands. I would personally use Postgres with indexed tables for `people`, `jobs` etc and a department classification Redis cache; indexes would be on `(account_url, country)` and `(account_url, department)`. Department classification would become a batch job triggered by data ingestion instead of a startup cost - results will be persisted and only recomputed for new/modified titles. 

The intent classification would move away from a fixed enum to use a registrable handler where new query types can be added without modifying the routing logic. I would implement a confidence score on the LLM classification which would let us route ambiguous queries to a clarification response rather than guessing it. Over time, we would fine-tune accumulated query logs to train a smaller, cheaper model to replace 4o-mini for intent parsing. 

At scale, I believe the hardest problem is company name resolution; three companies with distinct names is cool, but what if we have thousands of companies, with subsidiaries, acquisitions, identical names between locales etc. - an LLM matching layer with fuzzy search (with `pg_trgm`) can be a solution. 
